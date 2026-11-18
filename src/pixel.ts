import * as THREE from 'three';

/** Screen pixels covered by one art pixel. */
const PIXEL_SIZE = 3;
const MIN_ROWS = 200;
/** The scene is rendered at this multiple of the art resolution and averaged down. */
const SUPERSAMPLE = 2;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform vec2 uRes;
  uniform float uNear;
  uniform float uFar;
  uniform vec3 uInk;
  varying vec2 vUv;

  float viewZ(vec2 uv) {
    float d = texture2D(tDepth, uv).r;
    return (uNear * uFar) / (uFar - d * (uFar - uNear));
  }

  float bayer(vec2 p) {
    vec2 q = mod(floor(p), 4.0);
    float i = q.x + q.y * 4.0;
    float v = 0.0;
    if (i < 0.5) v = 0.0; else if (i < 1.5) v = 8.0; else if (i < 2.5) v = 2.0; else if (i < 3.5) v = 10.0;
    else if (i < 4.5) v = 12.0; else if (i < 5.5) v = 4.0; else if (i < 6.5) v = 14.0; else if (i < 7.5) v = 6.0;
    else if (i < 8.5) v = 3.0; else if (i < 9.5) v = 11.0; else if (i < 10.5) v = 1.0; else if (i < 11.5) v = 9.0;
    else if (i < 12.5) v = 15.0; else if (i < 13.5) v = 7.0; else if (i < 14.5) v = 13.0; else v = 5.0;
    return (v + 0.5) / 16.0 - 0.5;
  }

  void main() {
    vec2 cell = floor(vUv * uRes);
    vec2 uv = (cell + 0.5) / uRes;
    vec2 px = 1.0 / uRes;

    vec3 c = texture2D(tColor, uv).rgb;
    #ifdef TONE_MAPPING
      c = toneMapping(c);
    #endif
    c = linearToOutputTexel(vec4(c, 1.0)).rgb;

    // Soft, slightly warm pastel grade.
    float luma = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(luma), c, 1.55);
    c = mix(c, vec3(1.0, 0.9, 0.8), 0.05);
    c = clamp(c, 0.0, 1.0);

    // Flat banded shading (a whisper of dither hides banding seams), then a small palette.
    float dither = bayer(cell);
    luma = max(dot(c, vec3(0.299, 0.587, 0.114)), 0.001);
    float bands = 7.0;
    float banded = floor(luma * bands + 0.5 + dither * 0.12) / bands;
    c *= clamp(banded, 0.1, 1.0) / luma;
    c = floor(clamp(c, 0.0, 1.0) * 10.0 + 0.5) / 10.0;

    // Ink outline wherever this pixel sits clearly in front of a neighbour.
    float z = viewZ(uv);
    float gap = 0.0;
    gap = max(gap, viewZ(uv + vec2(px.x, 0.0)) - z);
    gap = max(gap, viewZ(uv - vec2(px.x, 0.0)) - z);
    gap = max(gap, viewZ(uv + vec2(0.0, px.y)) - z);
    gap = max(gap, viewZ(uv - vec2(0.0, px.y)) - z);
    float edge = smoothstep(0.022, 0.04, gap);
    c = mix(c, uInk, edge * 0.88);

    gl_FragColor = vec4(c, 1.0);
  }
`;

/** Renders the scene at low resolution and repaints it as outlined, banded pixel art. */
export class PixelPass {
  private target: THREE.WebGLRenderTarget;
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor() {
    this.target = this.makeTarget(320, 180);
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: this.target.texture },
        tDepth: { value: this.target.depthTexture },
        uRes: { value: new THREE.Vector2(320, 180) },
        uNear: { value: 0.05 },
        uFar: { value: 30 },
        uInk: { value: new THREE.Color(0x2d2440).convertLinearToSRGB() },
      },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  private makeTarget(width: number, height: number) {
    const target = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
    target.depthTexture = new THREE.DepthTexture(width, height);
    target.depthTexture.minFilter = THREE.NearestFilter;
    target.depthTexture.magFilter = THREE.NearestFilter;
    return target;
  }

  setSize(width: number, height: number) {
    const rows = Math.max(MIN_ROWS, Math.round(height / PIXEL_SIZE));
    const cols = Math.max(1, Math.round((rows * width) / height));
    if (cols * SUPERSAMPLE === this.target.width && rows * SUPERSAMPLE === this.target.height) return;
    this.target.depthTexture?.dispose();
    this.target.dispose();
    this.target = this.makeTarget(cols * SUPERSAMPLE, rows * SUPERSAMPLE);
    this.material.uniforms.tColor.value = this.target.texture;
    this.material.uniforms.tDepth.value = this.target.depthTexture;
    (this.material.uniforms.uRes.value as THREE.Vector2).set(cols, rows);
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.material.uniforms.uNear.value = camera.near;
    this.material.uniforms.uFar.value = camera.far;
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(this.quadScene, this.quadCamera);
  }
}
