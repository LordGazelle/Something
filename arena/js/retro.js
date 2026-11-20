// Ретро-рендер: сцена малюється в низькій роздільності, потім масштабується
// «піксель у піксель» з постеризацією, дизерингом Байєра та сканлайнами.
import * as THREE from '../vendor/three.module.min.js';

export const snapUniform = { value: new THREE.Vector2(160, 120) };

// PS1-ефект: вершини «прилипають» до грубої сітки екрана
export function retroMaterial(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSnap = snapUniform;
    shader.vertexShader = 'uniform vec2 uSnap;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
       gl_Position.xy = floor(gl_Position.xy / gl_Position.w * uSnap + 0.5) / uSnap * gl_Position.w;`
    );
  };
  return mat;
}

const POST_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const POST_FS = `
precision highp float;
uniform sampler2D tDiffuse; uniform vec2 uLow; uniform float uTime; uniform float uHurt; uniform float uLevels;
varying vec2 vUv;
float bayer(vec2 p){
  ivec2 i = ivec2(mod(p, 4.0));
  int idx = i.x + i.y*4;
  float m[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
  for(int k=0;k<16;k++) if(k==idx) return m[k]/16.0 - 0.5;
  return 0.0;
}
void main(){
  vec2 uv = vUv;
  vec3 c = texture2D(tDiffuse, uv).rgb;
  // легка хроматична аберація по краях
  vec2 q = uv - 0.5;
  float e = dot(q,q);
  c.r = mix(c.r, texture2D(tDiffuse, uv + q*0.006).r, 0.7);
  c.b = mix(c.b, texture2D(tDiffuse, uv - q*0.006).b, 0.7);
  c = pow(max(c, 0.0), vec3(1.0/2.2)); // лінійне → sRGB
  // дизеринг + постеризація
  vec2 px = floor(uv * uLow);
  c += bayer(px) / uLevels;
  c = floor(c * uLevels + 0.5) / uLevels;
  // сканлайни та віньєтка
  float scan = 0.9 + 0.1 * sin((uv.y * uLow.y) * 3.14159 * 2.0);
  c *= scan;
  c *= 1.0 - e * 1.1;
  // червоний спалах при пошкодженні
  c = mix(c, vec3(0.9, 0.05, 0.08), uHurt * (0.25 + e * 1.4));
  gl_FragColor = vec4(c, 1.0);
}`;

export class RetroRenderer {
  constructor(canvas) {
    this.r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.r.setPixelRatio(1);
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.lowH = 300;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.post = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: this.rt.texture }, uLow: { value: new THREE.Vector2() }, uTime: { value: 0 }, uHurt: { value: 0 }, uLevels: { value: 28 } },
      vertexShader: POST_VS, fragmentShader: POST_FS, depthTest: false, depthWrite: false,
    });
    this.postScene = new THREE.Scene();
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post));
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.resize();
  }
  setQuality(h) { this.lowH = h; this.resize(); }
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.r.setSize(w, h, false);
    const lh = Math.min(this.lowH, h), lw = Math.round(lh * w / h);
    this.rt.setSize(lw, lh);
    this.post.uniforms.uLow.value.set(lw, lh);
    snapUniform.value.set(lw / 2.2, lh / 2.2);
    this.aspect = w / h;
  }
  render(scene, camera, hurt = 0) {
    this.post.uniforms.uHurt.value = hurt;
    this.r.setRenderTarget(this.rt);
    this.r.render(scene, camera);
    this.r.setRenderTarget(null);
    this.r.render(this.postScene, this.postCam);
  }
}

// Процедурні піксельні текстури
export function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
