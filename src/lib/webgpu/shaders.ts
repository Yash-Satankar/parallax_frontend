/**
 * webgpu/shaders.ts
 *
 * WGSL shader source strings for the Parallax GPU compositor.
 * Three render passes in sequence:
 *   1. TRANSFORM — vertex shader positions & crops each clip layer
 *   2. GRADE     — fragment shader applies color correction per-pixel
 *   3. COMPOSITE — alpha-blends all layers in Z-order onto the output texture
 *
 * Uniforms map 1:1 to the TimelineTransform and TimelineColor types in types.ts,
 * so no data conversion is needed between the React store and the GPU pipeline.
 */

// ─── Shared vertex shader ─────────────────────────────────────────────────────
// Draws a full-screen quad; used by both the grade and composite passes.

export const VERTEX_QUAD_WGSL = /* wgsl */`
struct VertexOut {
  @builtin(position) pos  : vec4f,
  @location(0)       uv   : vec2f,
}

// Transform uniform: position, scale, rotation, crop (matches TimelineTransform)
struct TransformUniforms {
  x        : f32,
  y        : f32,
  scaleX   : f32,
  scaleY   : f32,
  rotation : f32,
  opacity  : f32,
  cropTop  : f32,
  cropRight : f32,
  cropBottom : f32,
  cropLeft  : f32,
  _pad0    : f32,
  _pad1    : f32,
}
@group(0) @binding(2) var<uniform> transform : TransformUniforms;

@vertex fn vs_main(@builtin(vertex_index) vi: u32) -> VertexOut {
  // Unit quad corners in clip space
  var pos = array<vec2f, 6>(
    vec2f(-1.0,  1.0), vec2f( 1.0,  1.0), vec2f(-1.0, -1.0),
    vec2f(-1.0, -1.0), vec2f( 1.0,  1.0), vec2f( 1.0, -1.0),
  );
  var uv = array<vec2f, 6>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
    vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),
  );

  // Apply crop to UV
  let u = mix(transform.cropLeft, 1.0 - transform.cropRight, uv[vi].x);
  let v = mix(transform.cropTop,  1.0 - transform.cropBottom, uv[vi].y);

  // Apply 2D transform to position
  let cos_r = cos(transform.rotation);
  let sin_r = sin(transform.rotation);
  var p = pos[vi];
  p = p * vec2f(transform.scaleX, transform.scaleY);
  p = vec2f(p.x * cos_r - p.y * sin_r, p.x * sin_r + p.y * cos_r);
  p = p + vec2f(transform.x, transform.y);

  var out : VertexOut;
  out.pos = vec4f(p, 0.0, 1.0);
  out.uv  = vec2f(u, v);
  return out;
}
`

// ─── Grade fragment shader ────────────────────────────────────────────────────
// Maps TimelineColor { exposure, contrast, saturation, temperature, tint }
// to per-pixel RGBA corrections.

export const GRADE_FRAGMENT_WGSL = /* wgsl */`
struct GradeUniforms {
  exposure    : f32,   // multiplicative gain (1.0 = no change)
  contrast    : f32,   // S-curve strength  (1.0 = no change)
  saturation  : f32,   // 0=greyscale, 1=original, 2=hyper-saturated
  temperature : f32,   // negative=cool (blue), positive=warm (orange), -1..1
  tint        : f32,   // negative=magenta, positive=green, -1..1
}

@group(0) @binding(0) var videoTex  : texture_external;
@group(0) @binding(1) var texSampler: sampler;
@group(0) @binding(3) var<uniform> grade : GradeUniforms;

fn applyCurve(x: f32, strength: f32) -> f32 {
  // Smooth S-curve centred at 0.5; strength=1 is identity
  let s = (strength - 1.0) * 0.5;
  return clamp(x + s * sin(3.14159 * x), 0.0, 1.0);
}

@fragment fn fs_grade(@location(0) uv: vec2f) -> @location(0) vec4f {
  var col = textureSampleBaseClampToEdge(videoTex, texSampler, uv);

  // 1. Exposure — multiplicative gain in linear light
  col = vec4f(col.rgb * grade.exposure, col.a);

  // 2. Contrast — S-curve around 0.5
  col = vec4f(
    vec3f(
      applyCurve(col.r, grade.contrast),
      applyCurve(col.g, grade.contrast),
      applyCurve(col.b, grade.contrast),
    ),
    col.a,
  );

  // 3. Saturation — lerp to luminance greyscale
  let luma = dot(col.rgb, vec3f(0.2126, 0.7152, 0.0722));
  col = vec4f(mix(vec3f(luma), col.rgb, grade.saturation), col.a);

  // 4. Temperature — shifts warm/cool by adjusting R and B channels
  //    temperature > 0 → warmer (more R, less B)
  col = vec4f(
    col.r + grade.temperature * 0.1,
    col.g,
    col.b - grade.temperature * 0.1,
    col.a,
  );

  // 5. Tint — shifts green/magenta by adjusting G channel
  col = vec4f(col.r, col.g + grade.tint * 0.1, col.b, col.a);

  return clamp(col, vec4f(0.0), vec4f(1.0));
}
`

// ─── Composite fragment shader ────────────────────────────────────────────────
// Alpha-blends a pre-graded layer texture onto the accumulator with opacity.

export const COMPOSITE_FRAGMENT_WGSL = /* wgsl */`
struct CompositeUniforms {
  opacity : f32,
  _pad    : vec3f,
}

@group(0) @binding(0) var layerTex  : texture_2d<f32>;
@group(0) @binding(1) var texSampler: sampler;
@group(0) @binding(2) var accumTex  : texture_2d<f32>;
@group(0) @binding(3) var<uniform> comp : CompositeUniforms;

@fragment fn fs_composite(@location(0) uv: vec2f) -> @location(0) vec4f {
  let layer = textureSample(layerTex,  texSampler, uv);
  let accum = textureSample(accumTex, texSampler, uv);
  // Pre-multiplied alpha blend
  let a = layer.a * comp.opacity;
  return vec4f(mix(accum.rgb, layer.rgb, a), max(accum.a, a));
}
`
