/* CHRONOS — камера, що бачить крізь час.
 * Чистий WebGL2, без залежностей. Усе рахується на GPU пристрою.
 */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const canvas = $('#gl');
  const video = $('#video');

  // ---------------------------------------------------------------- режими
  const MODES = [
    {
      id: 'flux', name: 'Рідкий час', tag: 'CHRONO · FLUX',
      desc: 'Кожен піксель живе у власному моменті. Верх — зараз, низ — секунду тому. Рухайтеся — і простір потече.',
      controls: [
        { type: 'chips', key: 'pattern', options: [['Каскад', 0], ['Портал', 1], ['Рідина', 2], ['Дотик', 3]] },
        { type: 'range', key: 'depth', label: 'Глибина', min: 4, max: 58, step: 1, fmt: (v) => (v / 30).toFixed(1) + 'с' },
        { type: 'chips', key: 'rgb', options: [['Чистий', 0], ['RGB-розшарування', 1]] },
      ],
      state: { pattern: 0, depth: 42, rgb: 0 },
    },
    {
      id: 'slit', name: 'Розлом часу', tag: 'SLIT · SCAN',
      desc: 'Лінія сканує світ, заморожуючи кожен рядок у свій момент. Рухайтеся разом із нею — і станьте сюрреалістичною скульптурою.',
      controls: [
        { type: 'chips', key: 'dir', options: [['Згори вниз', 0], ['Зліва направо', 1]] },
        { type: 'range', key: 'speed', label: 'Швидкість', min: 0.03, max: 0.35, step: 0.01, fmt: (v) => (1 / v).toFixed(0) + 'с' },
        { type: 'action', key: 'scan', label: '▶  Почати сканування' },
      ],
      state: { dir: 0, speed: 0.09 },
    },
    {
      id: 'holo', name: 'Голограма', tag: 'VOLUMETRIC · CLOUD',
      desc: 'Зображення розпадається на десятки тисяч світних частинок у 3D. Тягніть пальцем або нахиляйте телефон.',
      controls: [
        { type: 'range', key: 'depth', label: 'Об’єм', min: 0, max: 1.6, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' },
        { type: 'chips', key: 'color', options: [['Неон', 0], ['Справжні кольори', 1], ['Золото', 2]] },
      ],
      state: { depth: 0.85, color: 0 },
    },
    {
      id: 'thermal', name: 'Тепловізор', tag: 'INFRARED · SIM',
      desc: 'Погляд мисливця в інфрачервоному спектрі. Рух нагріває простір — спробуйте помахати рукою.',
      controls: [
        { type: 'range', key: 'gain', label: 'Чутливість', min: 0, max: 2, step: 0.05, fmt: (v) => Math.round(v * 50) + '%' },
        { type: 'chips', key: 'pal', options: [['Залізо', 0], ['Веселка', 1], ['Нічне', 2]] },
      ],
      state: { gain: 1, pal: 0 },
    },
    {
      id: 'ascii', name: 'Матриця', tag: 'GLYPH · RAIN',
      desc: 'Реальність, складена із символів. Кожна клітинка — живий гліф, що відповідає яскравості світу.',
      controls: [
        { type: 'range', key: 'cell', label: 'Розмір', min: 6, max: 26, step: 1, fmt: (v) => v + 'px' },
        { type: 'chips', key: 'pal', options: [['Матриця', 1], ['Колір', 0], ['Бурштин', 2], ['Неон', 3]] },
      ],
      state: { cell: 11, pal: 1 },
    },
    {
      id: 'light', name: 'Світлопис', tag: 'MOTION · TRAILS',
      desc: 'Рух залишає неонові сліди, що повільно згасають. Махніть рукою чи ліхтариком у темряві — і малюйте світлом.',
      controls: [
        { type: 'range', key: 'decay', label: 'Слід', min: 0.85, max: 0.995, step: 0.005, fmt: (v) => (1 / (1 - v) / 30).toFixed(1) + 'с' },
        { type: 'range', key: 'gain', label: 'Яскравість', min: 0.3, max: 3, step: 0.1, fmt: (v) => v.toFixed(1) + '×' },
        { type: 'action', key: 'clear', label: '✦  Очистити полотно' },
      ],
      state: { decay: 0.965, gain: 1.6 },
    },
  ];
  let modeIdx = 0;
  const mode = () => MODES[modeIdx];

  // ---------------------------------------------------------------- WebGL
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });

  const VERT = `#version 300 es
  out vec2 vUv;
  void main(){ vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); vUv = p; gl_Position = vec4(p*2.0-1.0, 0.0, 1.0); }`;

  const COMMON = `#version 300 es
  precision highp float;
  precision highp sampler2DArray;
  in vec2 vUv;
  out vec4 o;
  uniform sampler2D uVideo;
  uniform vec2 uCover;
  uniform float uMirror;
  uniform float uTime;
  uniform vec2 uRes;
  vec2 vidUv(vec2 uv){ vec2 p = (uv-0.5)*uCover+0.5; if(uMirror>0.5) p.x = 1.0-p.x; return p; }
  vec3 vid(vec2 uv){ return texture(uVideo, vidUv(uv)).rgb; }
  float luma(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
  vec3 hue(float h){ return clamp(abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0, 0.0, 1.0); }
  vec3 post(vec3 c){
    vec2 q = vUv-0.5;
    c *= 1.0 - dot(q,q)*0.85;
    c += (hash(gl_FragCoord.xy + fract(uTime*7.0)*91.0)-0.5)*0.03;
    return c;
  }
  `;

  const FS = {
    blit: `#version 300 es
    precision highp float; in vec2 vUv; out vec4 o; uniform sampler2D uVideo;
    void main(){ o = vec4(texture(uVideo, vUv).rgb, 1.0); }`,

    live: COMMON + `void main(){ o = vec4(vid(vUv), 1.0); }`,

    slit: COMMON + `
    uniform sampler2D uFrozen; uniform float uLine; uniform float uDir; uniform float uState;
    void main(){
      float t = uDir < 0.5 ? 1.0 - vUv.y : vUv.x;
      vec3 live = vid(vUv);
      vec3 fr = texture(uFrozen, vUv).rgb;
      vec3 c = live;
      if(uState > 1.5) c = fr;
      else if(uState > 0.5){
        float px = uDir < 0.5 ? uRes.y : uRes.x;
        float d = (t - uLine) * px;
        if(d < 0.0) c = fr;
        else c = mix(live, vec3(luma(live))*vec3(0.55,0.75,1.0), 0.55);
        float ad = abs(d);
        c += vec3(0.25,0.9,1.0)*(exp(-ad*0.3)*1.8 + exp(-ad*0.03)*0.25);
        c += vec3(1.0,0.4,0.9)*exp(-ad*0.08)*0.25;
      } else {
        // очікування: м’яка пульсуюча лінія старту
        float px = uDir < 0.5 ? uRes.y : uRes.x;
        float ad = abs(t - 0.004) * px;
        c += vec3(0.25,0.9,1.0)*exp(-ad*0.2)*(0.6+0.4*sin(uTime*4.0));
      }
      o = vec4(post(c), 1.0);
    }`,

    flux: COMMON + `
    uniform sampler2DArray uHist; uniform float uHead; uniform float uN; uniform float uDepth;
    uniform int uPattern; uniform vec2 uTouch; uniform float uRGB;
    float delayAt(vec2 uv){
      vec2 a = vec2(uRes.x/uRes.y, 1.0);
      if(uPattern == 0) return 1.0 - uv.y;
      if(uPattern == 1) return clamp(length((uv-0.5)*a)*1.7, 0.0, 1.0);
      if(uPattern == 2) return 0.5 + 0.5*sin(uv.x*6.0 + uTime*1.1 + sin(uv.y*4.0+uTime*0.7)*1.5)*cos(uv.y*5.0 - uTime*0.8);
      float r = length((uv-uTouch)*a);
      return clamp(0.5 + 0.5*sin(r*16.0 - uTime*3.0), 0.0, 1.0) * smoothstep(0.9, 0.0, r);
    }
    vec3 at(vec2 v, float f){
      f = clamp(f, 0.0, uN-2.0);
      float i = floor(f), fr = f - i;
      float l0 = mod(uHead - i + uN, uN), l1 = mod(uHead - i - 1.0 + uN, uN);
      return mix(texture(uHist, vec3(v, l0)).rgb, texture(uHist, vec3(v, l1)).rgb, fr);
    }
    void main(){
      vec2 v = vidUv(vUv);
      float f = delayAt(vUv) * uDepth;
      vec3 c;
      if(uRGB > 0.5){
        float s = 2.0 + uDepth*0.1;
        c = vec3(at(v, f).r, at(v, f+s).g, at(v, f+2.0*s).b);
      } else c = at(v, f);
      o = vec4(post(c*1.04), 1.0);
    }`,

    thermal: COMMON + `
    uniform sampler2DArray uHist; uniform float uHead; uniform float uN; uniform float uGain; uniform int uPal;
    vec3 ramp(float t){
      t = clamp(t, 0.0, 1.0);
      if(uPal == 1){ return hue(0.7 - t*0.75) * smoothstep(0.0, 0.15, t) + vec3(smoothstep(0.85,1.0,t)); }
      if(uPal == 2){ return vec3(0.1,1.0,0.35)*pow(t,0.9)*1.2 + vec3(smoothstep(0.8,1.0,t))*0.6; }
      vec3 c0 = vec3(0.0,0.0,0.03), c1 = vec3(0.13,0.0,0.45), c2 = vec3(0.6,0.0,0.6),
           c3 = vec3(0.95,0.25,0.05), c4 = vec3(1.0,0.75,0.0), c5 = vec3(1.0,1.0,0.9);
      float s = t*5.0;
      if(s < 1.0) return mix(c0,c1,s);
      if(s < 2.0) return mix(c1,c2,s-1.0);
      if(s < 3.0) return mix(c2,c3,s-2.0);
      if(s < 4.0) return mix(c3,c4,s-3.0);
      return mix(c4,c5,s-4.0);
    }
    void main(){
      vec2 v = vidUv(vUv);
      vec2 px = 1.6 / vec2(textureSize(uHist, 0).xy);
      float p = mod(uHead - 3.0 + uN, uN);
      float l = 0.0, m = 0.0;
      for(int y=-1; y<=1; y++) for(int x=-1; x<=1; x++){
        vec2 q = v + vec2(x,y)*px;
        float a = luma(texture(uHist, vec3(q, uHead)).rgb);
        float b = luma(texture(uHist, vec3(q, p)).rgb);
        l += a; m += abs(a-b);
      }
      l /= 9.0; m /= 9.0;
      float heat = pow(l, 1.25)*0.78 + smoothstep(0.015, 0.12, m)*0.55*uGain;
      heat += (hash(floor(gl_FragCoord.xy/2.0)+floor(uTime*24.0))-0.5)*0.025;
      o = vec4(post(ramp(heat)), 1.0);
    }`,

    ascii: COMMON + `
    uniform sampler2D uAtlas; uniform float uCell; uniform int uPal;
    void main(){
      vec2 cs = vec2(uCell, uCell*1.5);
      vec2 cell = floor(gl_FragCoord.xy / cs);
      vec2 local = fract(gl_FragCoord.xy / cs);
      vec3 col = vid((cell+0.5)*cs/uRes);
      float l = smoothstep(0.04, 0.92, luma(col));
      float rows = uRes.y / cs.y;
      float seed = hash(vec2(cell.x, 3.7));
      float yTop = rows - cell.y;
      float hp = fract(uTime*(0.08 + seed*0.22) + seed) * (rows*1.6) - rows*0.3;
      float d = hp - yTop;
      float trail = d > 0.0 ? exp(-d*0.09) : 0.0;
      float head = smoothstep(1.5, 0.0, abs(d));
      float idx = floor(l*15.99);
      float row = 1.0;
      if(uPal == 1){
        row = 0.0;
        float flick = floor(uTime*(4.0+seed*8.0));
        idx = floor(hash(cell + flick*0.37)*16.0);
        if(l < 0.07 && trail < 0.05) idx = 0.0;
      }
      float g = texture(uAtlas, vec2((idx + local.x)/16.0, (row + local.y)/2.0)).r;
      vec3 c;
      if(uPal == 1){
        float b = l*0.85 + trail*0.9;
        c = vec3(0.15,1.0,0.45)*g*b + vec3(0.8,1.0,0.85)*g*head*1.2 + vec3(0.0,0.05,0.02)*l;
      } else if(uPal == 0){
        c = col*g*1.5 + col*0.06;
      } else if(uPal == 2){
        c = vec3(1.0,0.62,0.15)*g*(l*1.4+0.05) + vec3(0.05,0.02,0.0);
      } else {
        c = hue(cell.x*0.012 + cell.y*0.006 - uTime*0.15)*g*(l*1.5+trail*0.4);
      }
      o = vec4(post(c), 1.0);
    }`,

    lightFb: COMMON + `
    uniform sampler2D uPrev; uniform sampler2DArray uHist; uniform float uHead; uniform float uN;
    uniform float uDecay; uniform float uGain;
    void main(){
      vec2 v = vidUv(vUv);
      vec3 a = texture(uHist, vec3(v, uHead)).rgb;
      vec3 b = texture(uHist, vec3(v, mod(uHead-1.0+uN, uN))).rgb;
      float m = smoothstep(0.07, 0.3, length(a-b));
      float bright = smoothstep(0.8, 0.97, luma(a));
      vec3 add = hue(uTime*0.07 + vUv.y*0.35 + vUv.x*0.15)*m*uGain*0.75 + mix(a, vec3(1.0), 0.3)*bright*uGain*0.6;
      vec3 prev = texture(uPrev, vUv).rgb * uDecay;
      o = vec4(max(prev, add), 1.0);
    }`,

    lightShow: COMMON + `
    uniform sampler2D uTrail;
    void main(){
      vec2 px = 1.0/vec2(textureSize(uTrail, 0));
      vec3 t = texture(uTrail, vUv).rgb;
      vec3 glow = vec3(0.0);
      for(int i=0; i<8; i++){
        float an = float(i)*0.785398;
        glow += texture(uTrail, vUv + vec2(cos(an), sin(an))*px*5.0).rgb;
        glow += texture(uTrail, vUv + vec2(cos(an), sin(an))*px*12.0).rgb*0.6;
      }
      glow /= 12.8;
      vec3 live = vid(vUv);
      vec3 c = live*0.32 + t*1.05 + glow*0.9;
      o = vec4(post(c), 1.0);
    }`,
  };

  const HOLO_VS = `#version 300 es
  precision highp float;
  in vec2 aUv;
  uniform sampler2D uVideo; uniform vec2 uCover; uniform float uMirror; uniform float uTime; uniform vec2 uRes;
  uniform vec2 uRot; uniform float uDepth; uniform float uSize; uniform int uColor;
  out vec3 vCol; out float vA;
  vec2 vidUv(vec2 uv){ vec2 p = (uv-0.5)*uCover+0.5; if(uMirror>0.5) p.x = 1.0-p.x; return p; }
  void main(){
    vec3 c = textureLod(uVideo, vidUv(aUv), 0.0).rgb;
    float l = dot(c, vec3(0.299,0.587,0.114));
    float asp = uRes.x/uRes.y;
    float glitch = step(0.992, fract(aUv.y*2.0 - uTime*0.21)) * (fract(sin(uTime*40.0)*999.0)-0.5)*0.15;
    vec3 p = vec3((aUv.x-0.5)*2.0*asp + glitch, (aUv.y-0.5)*2.0, (l-0.45)*uDepth);
    p.z += sin(aUv.y*30.0 - uTime*3.0)*0.012*uDepth;
    p *= 0.86;
    float cy = cos(uRot.x), sy = sin(uRot.x), cx = cos(uRot.y), sx = sin(uRot.y);
    p = vec3(p.x*cy + p.z*sy, p.y, -p.x*sy + p.z*cy);
    p = vec3(p.x, p.y*cx - p.z*sx, p.y*sx + p.z*cx);
    float D = 3.2;
    float w = (D - p.z)/D;
    gl_Position = vec4(p.x/asp, p.y, 0.0, w);
    gl_PointSize = uSize / w;
    if(uColor == 1) vCol = c*1.25;
    else if(uColor == 2) vCol = mix(vec3(0.5,0.25,0.05), vec3(1.0,0.85,0.45), l) * (0.4+l*1.2);
    else vCol = mix(vec3(0.05,0.7,1.0), vec3(1.0,0.3,0.85), smoothstep(0.35,0.9,l)) * (0.35+l*1.3);
    vA = smoothstep(0.04, 0.3, l) * (0.55 + 0.45*sin(aUv.x*90.0 + uTime*2.0 + aUv.y*50.0));
  }`;
  const HOLO_FS = `#version 300 es
  precision highp float;
  in vec3 vCol; in float vA; out vec4 o;
  void main(){ float d = length(gl_PointCoord-0.5); float a = smoothstep(0.5, 0.05, d); o = vec4(vCol*a*vA, 1.0); }`;

  function shader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
    return s;
  }
  function program(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, shader(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const loc = {};
    p.u = (n) => (n in loc ? loc[n] : (loc[n] = gl.getUniformLocation(p, n)));
    return p;
  }

  let P = {}, emptyVao, holoVao, holoCount = 0, holoCols = 0;
  const T = {};      // текстури
  const F = {};      // фреймбуфери
  const HN = 60;     // кадрів в історії (≈2 c)
  let head = 0, histFilled = false, HW = 0, HH = 0;
  let W = 0, H = 0, dpr = 1;
  let vw = 0, vh = 0, mirror = 1, cover = [1, 1];

  function tex2D(w, h, filter = gl.LINEAR) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function fbo(t) {
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return f;
  }

  function initGL() {
    for (const k in FS) P[k] = program(VERT, FS[k]);
    P.holo = program(HOLO_VS, HOLO_FS);
    emptyVao = gl.createVertexArray();
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    T.video = tex2D(2, 2);
    T.atlas = buildAtlas();
  }

  // атлас гліфів: ряд 1 — ASCII-градієнт, ряд 0 — «матричні» символи
  function buildAtlas() {
    const cw = 48, ch = 72;
    const c = document.createElement('canvas');
    c.width = cw * 16; c.height = ch * 2;
    const x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
    const ramp = [' ', '.', '·', ':', '-', '~', '=', '+', '*', 'o', 'x', '%', '#', '&', '@', '█'];
    const kata = [' ', '0', '1', 'ア', 'イ', 'ウ', 'エ', 'カ', 'キ', 'ク', 'サ', 'シ', 'ス', 'ナ', 'ハ', 'ミ'];
    x.font = `700 ${ch * 0.78}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    ramp.forEach((g, i) => {
      if (g === '█') { x.fillRect(i * cw + 3, 4, cw - 6, ch - 8); return; }
      x.fillText(g, i * cw + cw / 2, ch / 2 + 2);
    });
    x.font = `600 ${ch * 0.6}px "Hiragino Sans", "Noto Sans JP", "Yu Gothic", ui-monospace, monospace`;
    kata.forEach((g, i) => {
      x.save(); x.translate(i * cw + cw / 2, ch + ch / 2); x.scale(-1, 1); // дзеркальні, як у фільмі
      x.fillText(g, 0, 2); x.restore();
    });
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  function allocHistory() {
    if (T.hist) gl.deleteTexture(T.hist);
    const a = vw / vh, M = 512;
    if (a >= 1) { HW = M; HH = Math.round(M / a); } else { HH = M; HW = Math.round(M * a); }
    T.hist = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, T.hist);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, HW, HH, HN);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (!F.hist) F.hist = gl.createFramebuffer();
    histFilled = false;
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = window.innerWidth, ch = window.innerHeight;
    // обмежуємо кількість пікселів, щоб зберегти 60 fps на телефонах
    const maxPx = 2.3e6;
    if (cw * ch * dpr * dpr > maxPx) dpr = Math.sqrt(maxPx / (cw * ch));
    const nw = Math.round(cw * dpr), nh = Math.round(ch * dpr);
    if (nw === W && nh === H) return;
    W = canvas.width = nw; H = canvas.height = nh;

    ['frozen', 'trailA', 'trailB'].forEach((k) => { if (T[k]) { gl.deleteTexture(T[k]); gl.deleteFramebuffer(F[k]); } });
    T.frozen = tex2D(W, H); F.frozen = fbo(T.frozen);
    const tw = Math.round(W / 2), th = Math.round(H / 2);
    T.trailA = tex2D(tw, th); F.trailA = fbo(T.trailA);
    T.trailB = tex2D(tw, th); F.trailB = fbo(T.trailB);
    slit.state = 0;
    buildHolo();
    updateCover();
  }

  function updateCover() {
    if (!vw) return;
    const sa = W / H, va = vw / vh;
    cover = sa > va ? [1, va / sa] : [sa / va, 1];
  }

  function buildHolo() {
    const cols = Math.round(Math.min(240, Math.max(120, (W / dpr) / 2.1)));
    const rows = Math.round(cols * H / W);
    holoCols = cols;
    const data = new Float32Array(cols * rows * 2);
    let i = 0;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      data[i++] = (x + 0.5) / cols; data[i++] = (y + 0.5) / rows;
    }
    holoCount = cols * rows;
    if (!holoVao) {
      holoVao = gl.createVertexArray();
      gl.bindVertexArray(holoVao);
      T.holoBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, T.holoBuf);
      const loc = gl.getAttribLocation(P.holo, 'aUv');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    }
    gl.bindVertexArray(holoVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, T.holoBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
  }

  // ---------------------------------------------------------------- малювання
  function use(p) {
    gl.useProgram(p);
    gl.uniform1i(p.u('uVideo'), 0);
    gl.uniform2f(p.u('uCover'), cover[0], cover[1]);
    gl.uniform1f(p.u('uMirror'), mirror);
    gl.uniform1f(p.u('uTime'), time);
    gl.uniform2f(p.u('uRes'), W, H);
    return p;
  }
  function draw() { gl.bindVertexArray(emptyVao); gl.drawArrays(gl.TRIANGLES, 0, 3); }
  function target(f, w, h) { gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.viewport(0, 0, w, h); }
  function bindTex(unit, t, kind = gl.TEXTURE_2D) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(kind, t); }
  function histU(p) {
    gl.uniform1i(p.u('uHist'), 1);
    gl.uniform1f(p.u('uHead'), head);
    gl.uniform1f(p.u('uN'), HN);
  }

  function pushHistory() {
    bindTex(0, T.video);
    gl.useProgram(P.blit);
    gl.uniform1i(P.blit.u('uVideo'), 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, F.hist);
    gl.viewport(0, 0, HW, HH);
    const layers = histFilled ? [head = (head + 1) % HN] : [...Array(HN).keys()];
    for (const l of layers) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, T.hist, 0, l);
      draw();
    }
    if (!histFilled) { head = HN - 1; histFilled = true; }
  }

  const slit = { state: 0, line: 0 };
  const holo = { rx: 0, ry: 0, vx: 0, vy: 0, tiltX: 0, tiltY: 0 };
  const touch = { x: 0.5, y: 0.5, down: false, lx: 0, ly: 0 };
  let trailFlip = false, clearTrails = false;

  function render(dt) {
    const m = mode(), s = m.state;
    bindTex(0, T.video);
    bindTex(1, T.hist, gl.TEXTURE_2D_ARRAY);

    switch (m.id) {
      case 'flux': {
        target(null, W, H);
        const p = use(P.flux); histU(p);
        gl.uniform1f(p.u('uDepth'), s.depth);
        gl.uniform1i(p.u('uPattern'), s.pattern);
        gl.uniform2f(p.u('uTouch'), touch.x, touch.y);
        gl.uniform1f(p.u('uRGB'), s.rgb);
        draw();
        break;
      }
      case 'slit': {
        if (slit.state === 1) {
          const prev = slit.line;
          slit.line = Math.min(1, slit.line + s.speed * dt);
          const p = use(P.live);
          gl.bindFramebuffer(gl.FRAMEBUFFER, F.frozen);
          gl.viewport(0, 0, W, H);
          gl.enable(gl.SCISSOR_TEST);
          if (s.dir === 0) {
            const y0 = Math.floor(H * (1 - slit.line)), y1 = Math.ceil(H * (1 - prev));
            gl.scissor(0, y0, W, Math.max(1, y1 - y0));
          } else {
            const x0 = Math.floor(W * prev), x1 = Math.ceil(W * slit.line);
            gl.scissor(x0, 0, Math.max(1, x1 - x0), H);
          }
          draw();
          gl.disable(gl.SCISSOR_TEST);
          void p;
          if (slit.line >= 1) { slit.state = 2; onSlitDone(); }
          $('#slitBar').style.width = (slit.line * 100).toFixed(1) + '%';
        }
        target(null, W, H);
        bindTex(2, T.frozen);
        const p = use(P.slit);
        gl.uniform1i(p.u('uFrozen'), 2);
        gl.uniform1f(p.u('uLine'), slit.line);
        gl.uniform1f(p.u('uDir'), s.dir);
        gl.uniform1f(p.u('uState'), slit.state);
        draw();
        break;
      }
      case 'holo': {
        // інерція обертання + м’яке погойдування + нахил телефону
        if (!touch.down) { holo.rx += holo.vx; holo.ry += holo.vy; holo.vx *= 0.94; holo.vy *= 0.94; holo.rx *= 0.985; holo.ry *= 0.985; }
        const rx = holo.rx + Math.sin(time * 0.5) * 0.28 + holo.tiltX;
        const ry = holo.ry + Math.sin(time * 0.37) * 0.12 + holo.tiltY;
        target(null, W, H);
        gl.clearColor(0.008, 0.012, 0.03, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
        const p = use(P.holo);
        gl.uniform2f(p.u('uRot'), rx, ry);
        gl.uniform1f(p.u('uDepth'), s.depth);
        gl.uniform1f(p.u('uSize'), (W / holoCols) * 1.35);
        gl.uniform1i(p.u('uColor'), s.color);
        gl.bindVertexArray(holoVao);
        gl.drawArrays(gl.POINTS, 0, holoCount);
        gl.disable(gl.BLEND);
        break;
      }
      case 'thermal': {
        target(null, W, H);
        const p = use(P.thermal); histU(p);
        gl.uniform1f(p.u('uGain'), s.gain);
        gl.uniform1i(p.u('uPal'), s.pal);
        draw();
        if ((frameNo & 7) === 0) readTemp();
        break;
      }
      case 'ascii': {
        target(null, W, H);
        bindTex(3, T.atlas);
        const p = use(P.ascii);
        gl.uniform1i(p.u('uAtlas'), 3);
        gl.uniform1f(p.u('uCell'), Math.round(s.cell * dpr));
        gl.uniform1i(p.u('uPal'), s.pal);
        draw();
        break;
      }
      case 'light': {
        const src = trailFlip ? T.trailB : T.trailA;
        const dstF = trailFlip ? F.trailA : F.trailB;
        const dstT = trailFlip ? T.trailA : T.trailB;
        trailFlip = !trailFlip;
        if (clearTrails) {
          [F.trailA, F.trailB].forEach((f) => { gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); });
          clearTrails = false;
        }
        target(dstF, Math.round(W / 2), Math.round(H / 2));
        bindTex(2, src);
        let p = use(P.lightFb); histU(p);
        gl.uniform1i(p.u('uPrev'), 2);
        gl.uniform1f(p.u('uDecay'), s.decay);
        gl.uniform1f(p.u('uGain'), s.gain);
        draw();
        target(null, W, H);
        bindTex(2, dstT);
        p = use(P.lightShow);
        gl.uniform1i(p.u('uTrail'), 2);
        draw();
        break;
      }
    }
  }

  const px1 = new Uint8Array(4);
  let tempSmooth = 0;
  function readTemp() {
    gl.readPixels(W >> 1, Math.round(H * 0.54), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1);
    const v = (px1[0] * 0.45 + px1[1] * 0.4 + px1[2] * 0.15) / 255;
    const t = 16 + v * 22;
    tempSmooth = tempSmooth ? tempSmooth * 0.7 + t * 0.3 : t;
    $('#tempVal').textContent = tempSmooth.toFixed(1);
  }

  // ---------------------------------------------------------------- цикл
  let time = 0, last = 0, frameNo = 0, newFrame = true, running = false;
  let fpsAcc = 0, fpsN = 0;
  const hasRVFC = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
  function onVideoFrame() { newFrame = true; video.requestVideoFrameCallback(onVideoFrame); }

  function loop(now) {
    requestAnimationFrame(loop);
    if (!running) return;
    const dt = Math.min(0.1, last ? (now - last) / 1000 : 0.016);
    last = now; time += dt; frameNo++;
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) { $('#fps').textContent = Math.round(fpsN / fpsAcc) + ' fps'; fpsAcc = 0; fpsN = 0; }

    if (video.readyState >= 2 && (newFrame || !hasRVFC)) {
      gl.bindTexture(gl.TEXTURE_2D, T.video);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      pushHistory();
      newFrame = false;
    }
    render(dt);
    if (shotPending) { shotPending = false; capturePhoto(); }
  }

  // ---------------------------------------------------------------- камера
  let stream = null, facing = 'user';
  async function startCamera() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    });
    video.srcObject = stream;
    await video.play().catch(() => {});
    await new Promise((r) => (video.videoWidth ? r() : video.addEventListener('loadedmetadata', r, { once: true })));
    const settings = stream.getVideoTracks()[0].getSettings();
    const fm = settings.facingMode;
    mirror = fm === 'environment' ? 0 : (fm === 'user' || facing === 'user') ? 1 : 0;
    vw = video.videoWidth; vh = video.videoHeight;
    allocHistory();
    updateCover();
    if (hasRVFC) video.requestVideoFrameCallback(onVideoFrame);
    if (lightOn) await applyLight(); // нова камера — заново вмикаємо світло
  }

  // ---------------------------------------------------------------- світло
  // 'torch' — справжній ліхтар телефона; 'screen' — підсвітка екраном; 'off'
  let lightOn = false, lightMode = 'off';
  function videoTrack() { return stream && stream.getVideoTracks()[0]; }
  function torchSupported() {
    const t = videoTrack();
    try { return !!(t && t.getCapabilities && t.getCapabilities().torch); } catch (e) { return false; }
  }
  async function applyLight() {
    const t = videoTrack();
    let hw = false;
    if (t && torchSupported()) {
      try { await t.applyConstraints({ advanced: [{ torch: lightOn }] }); hw = true; }
      catch (e) {
        try { await t.applyConstraints({ torch: lightOn }); hw = true; } catch (e2) {}
      }
    }
    lightMode = !lightOn ? 'off' : hw ? 'torch' : 'screen';
    document.body.classList.toggle('ringlight', lightMode === 'screen');
    const b = $('#btnLight');
    b.classList.toggle('on', lightOn);
    b.setAttribute('aria-pressed', lightOn);
  }
  $('#btnLight').onclick = async () => {
    if (!running) return;
    lightOn = !lightOn;
    haptic(10);
    await applyLight();
    if (lightMode === 'torch') toast('Ліхтар увімкнено');
    else if (lightMode === 'screen') toast(facing === 'user' ? 'Підсвітка екраном увімкнена' : 'Ліхтар недоступний — світить екран');
    else toast('Світло вимкнено');
  };

  async function begin() {
    const btn = $('#btnStart'), note = $('#introNote');
    if (!gl) { note.textContent = 'Ваш браузер не підтримує WebGL2. Спробуйте свіжий Chrome або Safari.'; note.classList.add('err'); return; }
    if (!navigator.mediaDevices?.getUserMedia) { note.textContent = 'Камера доступна лише через HTTPS у сучасному браузері.'; note.classList.add('err'); return; }
    btn.disabled = true; btn.querySelector('span').textContent = 'Пробуджую сенсор…';
    // iOS: дозвіл на гіроскоп має запитуватися з жесту
    try { if (window.DeviceOrientationEvent?.requestPermission) DeviceOrientationEvent.requestPermission().catch(() => {}); } catch (e) {}
    try {
      initGL();
      resize();
      await startCamera();
      running = true;
      document.body.classList.add('live');
      $('#intro').classList.add('gone');
      setTimeout(() => $('#intro').remove(), 1000);
      toast('Гортайте режими внизу або свайпайте ↔');
      setCard(true);
    } catch (e) {
      console.error(e);
      btn.disabled = false; btn.querySelector('span').textContent = 'Спробувати ще раз';
      note.classList.add('err');
      note.textContent = e && e.name === 'NotAllowedError'
        ? 'Доступ до камери заборонено. Дозвольте його в налаштуваннях браузера.'
        : 'Не вдалося запустити камеру: ' + (e.message || e).toString().slice(0, 140);
    }
  }

  // ---------------------------------------------------------------- UI
  const modesEl = $('#modes');
  MODES.forEach((m, i) => {
    const b = document.createElement('button');
    b.className = 'mode'; b.textContent = m.name; b.dataset.i = i;
    b.onclick = () => setMode(i, true);
    modesEl.appendChild(b);
  });

  function setMode(i, scroll) {
    modeIdx = i;
    const m = mode();
    document.body.dataset.mode = m.id;
    [...modesEl.children].forEach((b, j) => b.classList.toggle('on', j === i));
    if (scroll) modesEl.children[i].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    $('#modeTag').textContent = m.tag;
    $('#modeTitle').textContent = m.name;
    $('#modeDesc').textContent = m.desc;
    buildControls();
    if (running) setCard(true);
    if (m.id === 'slit') { slit.state = 0; slit.line = 0; $('#slitBar').style.width = '0'; }
    if (m.id === 'light') clearTrails = true;
    try { localStorage.setItem('chronos.mode', m.id); } catch (e) {}
  }

  function buildControls() {
    const m = mode(), box = $('#controls');
    box.innerHTML = '';
    for (const c of m.controls) {
      if (c.type === 'chips') {
        const row = document.createElement('div'); row.className = 'chips';
        c.options.forEach(([label, val]) => {
          const b = document.createElement('button');
          b.className = 'chip' + (m.state[c.key] === val ? ' on' : '');
          b.textContent = label;
          b.onclick = () => { m.state[c.key] = val; [...row.children].forEach((x) => x.classList.remove('on')); b.classList.add('on'); onChange(c.key); };
          row.appendChild(b);
        });
        box.appendChild(row);
      } else if (c.type === 'range') {
        const row = document.createElement('label'); row.className = 'range';
        const span = document.createElement('span'); span.textContent = c.label;
        const inp = document.createElement('input');
        Object.assign(inp, { type: 'range', min: c.min, max: c.max, step: c.step, value: m.state[c.key] });
        const out = document.createElement('output');
        const sync = () => {
          const v = parseFloat(inp.value); m.state[c.key] = v;
          out.textContent = c.fmt(v);
          inp.style.setProperty('--p', ((v - c.min) / (c.max - c.min) * 100) + '%');
        };
        inp.oninput = sync; sync();
        row.append(span, inp, out);
        box.appendChild(row);
      } else if (c.type === 'action') {
        const b = document.createElement('button'); b.className = 'action'; b.textContent = c.label; b.id = 'act-' + c.key;
        b.onclick = () => action(c.key, b);
        box.appendChild(b);
      }
    }
  }

  function onChange(key) {
    if (mode().id === 'slit' && key === 'dir') { slit.state = 0; slit.line = 0; }
    if (mode().id === 'flux' && key === 'pattern' && mode().state.pattern === 3) toast('Торкніться екрана, щоб запустити хвилю часу');
  }

  function action(key, btn) {
    if (key === 'scan') {
      slit.state = 1; slit.line = 0;
      btn.textContent = '■  Сканування…';
      haptic(20);
    }
    if (key === 'clear') { clearTrails = true; haptic(10); }
  }
  function onSlitDone() {
    const b = $('#act-scan'); if (b) b.textContent = '↻  Сканувати знову';
    haptic([30, 40, 30]);
    toast('Готово! Натисніть затвор, щоб зберегти');
  }

  // картка налаштувань згортається сама, щоб не заступати кадр
  let cardT = 0;
  function setCard(open) {
    $('#card').classList.toggle('collapsed', !open);
    $('#cardHead').setAttribute('aria-expanded', open);
    clearTimeout(cardT);
    if (open) cardT = setTimeout(() => setCard(false), 6000);
  }
  $('#cardHead').onclick = () => setCard($('#card').classList.contains('collapsed'));
  $('#card').addEventListener('pointerdown', () => { if (!$('#card').classList.contains('collapsed')) setCard(true); });
  $('#card').addEventListener('input', () => setCard(true));

  // свайп по сцені вліво/вправо змінює режим (крім голограми й «дотику»)
  let swipe = null;
  canvas.addEventListener('pointerdown', (e) => {
    touch.down = true; touch.lx = e.clientX; touch.ly = e.clientY;
    swipe = { x: e.clientX, y: e.clientY, t: performance.now() };
    setTouch(e);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!touch.down) return;
    const dx = e.clientX - touch.lx, dy = e.clientY - touch.ly;
    touch.lx = e.clientX; touch.ly = e.clientY;
    if (mode().id === 'holo') { holo.rx += dx * 0.006; holo.ry += dy * 0.006; holo.vx = dx * 0.006; holo.vy = dy * 0.006; }
    setTouch(e);
  });
  const up = (e) => {
    touch.down = false;
    if (swipe && mode().id !== 'holo' && !(mode().id === 'flux' && mode().state.pattern === 3)) {
      const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && performance.now() - swipe.t < 600) {
        setMode((modeIdx + (dx < 0 ? 1 : -1) + MODES.length) % MODES.length, true);
        haptic(8);
      }
    }
    swipe = null;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', () => { touch.down = false; swipe = null; });
  function setTouch(e) { touch.x = e.clientX / window.innerWidth; touch.y = 1 - e.clientY / window.innerHeight; }

  window.addEventListener('deviceorientation', (e) => {
    if (e.gamma == null) return;
    holo.tiltX = Math.max(-0.6, Math.min(0.6, e.gamma / 45)) * 0.6;
    holo.tiltY = Math.max(-0.6, Math.min(0.6, ((e.beta || 0) - 50) / 45)) * 0.4;
  });

  window.addEventListener('resize', () => { if (running) resize(); });

  $('#btnFlip').onclick = async () => {
    facing = facing === 'user' ? 'environment' : 'user';
    haptic(10);
    try { await startCamera(); } catch (e) { toast('Не вдалося перемкнути камеру'); facing = facing === 'user' ? 'environment' : 'user'; }
  };

  // ---------------------------------------------------------------- фото / відео
  let shotPending = false, lastMedia = null;
  $('#shutter').onclick = () => {
    if (!running || flashBusy) return;
    haptic(15);
    const f = $('#flash');
    if (lightMode === 'screen') {
      // спалах екраном: біле світло освітлює обличчя, камера встигає підлаштувати експозицію
      flashBusy = true;
      f.classList.add('hold');
      setTimeout(() => { shotPending = true; }, 420);
      setTimeout(() => { f.classList.remove('hold'); flashBusy = false; }, 650);
      return;
    }
    shotPending = true;
    f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  };
  let flashBusy = false;

  function capturePhoto() {
    canvas.toBlob((blob) => {
      if (!blob) return toast('Не вдалося зберегти кадр');
      setMedia(blob, 'image', 'jpg');
    }, 'image/jpeg', 0.93);
  }

  function setMedia(blob, kind, ext) {
    if (lastMedia) URL.revokeObjectURL(lastMedia.url);
    const name = `chronos-${mode().id}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`;
    lastMedia = { blob, kind, url: URL.createObjectURL(blob), name };
    const th = $('#thumb');
    th.innerHTML = kind === 'image' ? `<img src="${lastMedia.url}" alt="">` : `<video src="${lastMedia.url}" muted playsinline autoplay loop></video>`;
    th.classList.remove('pop'); void th.offsetWidth; th.classList.add('pop');
  }

  $('#thumb').onclick = () => {
    if (!lastMedia) return toast('Ще немає знімків');
    const box = $('#sheetMedia');
    box.innerHTML = lastMedia.kind === 'image'
      ? `<img src="${lastMedia.url}" alt="Знімок">`
      : `<video src="${lastMedia.url}" controls playsinline autoplay loop></video>`;
    $('#btnShare').style.display = canShare() ? '' : 'none';
    $('#sheet').hidden = false;
  };
  const closeSheet = () => { $('#sheet').hidden = true; $('#sheetMedia').innerHTML = ''; };
  $('#btnClose').onclick = closeSheet;
  $('#sheet').onclick = (e) => { if (e.target.id === 'sheet') closeSheet(); };
  function fileOf(m) { return new File([m.blob], m.name, { type: m.blob.type }); }
  function canShare() { try { return !!(navigator.canShare && lastMedia && navigator.canShare({ files: [fileOf(lastMedia)] })); } catch (e) { return false; } }
  $('#btnSave').onclick = () => {
    const a = document.createElement('a');
    a.href = lastMedia.url; a.download = lastMedia.name;
    document.body.appendChild(a); a.click(); a.remove();
    toast('Збережено ✓');
  };
  $('#btnShare').onclick = async () => {
    try { await navigator.share({ files: [fileOf(lastMedia)], title: 'CHRONOS' }); } catch (e) {}
  };

  let rec = null, recChunks = [], recStart = 0, recTimer = 0;
  function pickMime() {
    const list = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    return list.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
  }
  $('#btnRec').onclick = () => {
    if (!running) return;
    if (rec) { rec.stop(); return; }
    if (!window.MediaRecorder || !canvas.captureStream) return toast('Запис відео не підтримується цим браузером');
    const mime = pickMime();
    const s = canvas.captureStream(30);
    try { rec = new MediaRecorder(s, mime ? { mimeType: mime, videoBitsPerSecond: 8e6 } : undefined); }
    catch (e) { return toast('Запис відео недоступний'); }
    recChunks = [];
    rec.ondataavailable = (e) => e.data.size && recChunks.push(e.data);
    rec.onstop = () => {
      const type = rec.mimeType || mime || 'video/webm';
      const blob = new Blob(recChunks, { type });
      setMedia(blob, 'video', type.includes('mp4') ? 'mp4' : 'webm');
      rec = null; clearInterval(recTimer);
      document.body.classList.remove('recording');
      s.getTracks().forEach((t) => t.stop());
      toast('Відео готове — торкніться мініатюри');
    };
    rec.start(250);
    recStart = performance.now();
    document.body.classList.add('recording');
    haptic(25);
    const tick = () => {
      const sec = Math.floor((performance.now() - recStart) / 1000);
      $('#recTime').textContent = String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
    };
    tick(); recTimer = setInterval(tick, 500);
  };

  // ---------------------------------------------------------------- дрібниці
  let toastT = 0;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2400);
  }
  function haptic(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} }

  document.addEventListener('visibilitychange', () => { last = 0; });

  let saved = 0;
  try { saved = Math.max(0, MODES.findIndex((m) => m.id === localStorage.getItem('chronos.mode'))); } catch (e) {}
  setMode(saved, false);
  $('#btnStart').onclick = begin;
  requestAnimationFrame(loop);

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
