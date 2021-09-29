"use strict";
const glsl = (x) => x[0]
const width = 800;
const height = 600;
const nsamples = 8;
const vertices = new Float32Array([
  -1.0, -1.0,
  1.0, -1.0,
  -1.0, 1.0,
  1.0, 1.0
]);

//vec3 cross
const cross = (a, b)=>{
  return [
    a[1] * b[2] - b[1] * a[2],
    b[0] * a[2] - a[0] * b[2],
    a[0] * b[1] - b[0] * a[1],
  ];
}

const normalize = (v)=>{
  const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

//默认顶点着色器
const vs_default_str = glsl`#version 300 es
#pragma vscode_glsllint_stage : vert
precision mediump float;
in vec2 position;
void main()
{
    gl_Position = vec4(position, 0.0, 1.0);
}
`;

//用于显示的像素着色器
const fs_display_str = glsl`#version 300 es
#pragma vscode_glsllint_stage : frag
precision mediump float;

uniform sampler2D tex;
out vec4 frag_color;
void main()
{
    vec2 uv = vec2(gl_FragCoord.x/800.0,gl_FragCoord.y/600.0);
    vec4 color = texture(tex, uv);
    frag_color = color;
}
`;

//用于计算光追的像素着色器
//主要参考了: https://raytracing.github.io/books/RayTracingInOneWeekend.html
//以及: https://raytracing.github.io/books/RayTracingTheNextWeek.html
const fs_ray_tracing_str = glsl`#version 300 es
#pragma vscode_glsllint_stage : frag
precision mediump float;

uniform uint iFrame;
uniform uint maxFrame;
uniform sampler2D tex;
uniform mat3 ca;
out vec4 frag_color;

vec3 lerp(vec3 a, vec3 b, float k)
{
  return (1.0-k) * a + k* b;
}

//#region rand
//gpu随机数
//参见: http://www.jcgt.org/published/0009/03/02/
//以及: https://www.shadertoy.com/view/XlGcRh
uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;

  v.x += v.y*v.z;
  v.y += v.z*v.x;
  v.z += v.x*v.y;

  v ^= v >> 16u;

  v.x += v.y*v.z;
  v.y += v.z*v.x;
  v.z += v.x*v.y;

  return v;
}

vec3 rand(uvec3 seed){
  return vec3(pcg3d(seed))*(1.0/float(0xffffffffu));
}

vec3 rand(uint seed){
  return vec3(pcg3d(uvec3(seed+1024u,seed+1025u,seed+1023u)))*(1.0/float(0xffffffffu));
}
//#endregion rand

//下面的代码基本是从RayTracingInOneWeekend中的c++代码平移过来的

//#region ray
struct ray
{
  vec3 orig;
  vec3 dir;
};

vec3 ray_at(ray r,float t)
{
  return r.orig+r.dir*t;
}
//#endregion ray

//#region hit_record
struct hit_record
{
  vec3 p;
  vec3 normal;
  float t;
  bool front_face;
};

void hit_record_set_face_normal(inout hit_record hr,in ray r,in vec3 outward_normal)
{
  hr.front_face = dot(r.dir,outward_normal)<0.0;
  hr.normal = hr.front_face ? outward_normal : - outward_normal;
}
//#endregion hit_record

//#region sphere
struct sphere
{
  vec3 center;
  float radius;
};

bool hit(in sphere s, in ray r,in float t_min,in float t_max,inout hit_record rec)
{
  vec3 oc = r.orig - s.center;
  float a = dot(r.dir,r.dir);
  float half_b = dot(oc, r.dir);
  float c = dot(oc, oc) - s.radius*s.radius;
  float discriminant = half_b*half_b - a*c;

  if (discriminant > 0.0) {
        float root = sqrt(discriminant);
        float temp = (-half_b - root)/a;
        if (temp < t_max && temp > t_min) {
            rec.t = temp;
            rec.p = ray_at(r,rec.t);
            vec3 outward_normal = (rec.p-s.center) /s.radius;
            hit_record_set_face_normal(rec, r, outward_normal);
            return true;
        }
        temp = (-half_b + root) / a;
        if (temp < t_max && temp > t_min) {
            rec.t = temp;
            rec.p = ray_at(r,rec.t);
            vec3 outward_normal = (rec.p-s.center) /s.radius;
            hit_record_set_face_normal(rec, r, outward_normal);
            return true;
        }
    }
    return false;
}
//#endregion

//#region camera
struct camera
{
  vec3 orig;
  vec3 lower_left_corner;
  vec3 horizontal;
  vec3 vertical;
};

mat3 camera_mat( in vec3 ro, in vec3 ta, float cr )
{
	vec3 cw = normalize(ta-ro);
	vec3 cp = vec3(sin(cr), cos(cr),0.0);
	vec3 cu = normalize( cross(cw,cp) );
	vec3 cv = cross(cu,cw);
  return mat3( cu, cv, cw );
}

camera create_camera()
{
  camera c = camera(
    ca*vec3(0.0, 0.0, 0.0),
    ca*vec3(-1.5, -1.0, -1.0),
    ca*vec3(3.0, 0.0, 0.0),
    ca*vec3(0.0, 2.0, 0.0)
  );
  return c;
}

ray get_ray(camera c,float u,float v)
{
  return ray(c.orig,c.lower_left_corner+u*c.horizontal+v*c.vertical-c.orig);
}
//#endregion camera

//todo: 使用uniform数组保存场景
sphere s = sphere(vec3(0.0,0.0,-1.0),0.5);
sphere s1 = sphere(vec3(0.0,-100.5,-1.0),100.0);
bool map(in ray r,inout hit_record hr){
  if(hit(s,r,0.01,10.0,hr)){
    return true;
  }
  if(hit(s1,r,0.01,10.0,hr)){
    return true;
  }
  return false;
}

//todo: 消除所有的inout限定符修饰的hr参数,转而使用hr全局变量，不过我并不知道编译器会不会将其优化到local register中
hit_record hr;
vec3 ray_color(ray r) {
  bool hit_anything = map(r, hr);
  if (hit_anything) {
      vec3 N = normalize(ray_at(r,hr.t) - vec3(0.0,0.0,-1.0));
      return 0.5*vec3(N.x+1.0, N.y+1.0, N.z+1.0);
  }
  vec3 dir = normalize(r.dir);
  float t = 0.5*(dir.y + 1.0);
  return lerp(vec3(1.0, 1.0, 1.0),vec3(0.5, 0.7, 1.0),t);
}

void main()
{
    vec2 uv = (gl_FragCoord.xy+vec2(0.5,0.5))/vec2(800.0,600.0);
    camera c = create_camera();
    vec3 ra = rand(iFrame)*0.002;
    ray r = get_ray(c,uv.x+ra.x,uv.y+ra.y);
    vec3 color = ray_color(r) / float(maxFrame);
    color += texture(tex,uv).rgb;
    frag_color = vec4(color, 1.0);
}
`;

//创建着色器
function create_program(gl, vs_src, fs_src) {
  const vs = gl.createShader(gl.VERTEX_SHADER);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(vs, vs_src);
  gl.shaderSource(fs, fs_src);
  gl.compileShader(vs);
  gl.compileShader(fs);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  return program;
}

//创建(浮点)纹理
function create_texture(gl){
  const tex =  gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  //要绑定到fbo需要颜色格式color_renderable
  //参见:https://www.khronos.org/registry/OpenGL/specs/es/3.0/es_spec_3.0.pdf#page=143&zoom=100,168,666
  //opengl中GL_RGB16F是color_renderable的，然而在opengl es(包括webgl)中不是
  //参见:https://stackoverflow.com/questions/69016956/webgl2-incomplete-framebuffer
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGB10_A2,
    width,
    height,
    0,
    gl.RGBA,
    gl.UNSIGNED_INT_2_10_10_10_REV,
    null
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

//主函数
function main() {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2");
  canvas.width = width;
  canvas.height = height;
  gl.viewport(0, 0, width, height);
  let yaw=0;
  let pitch=0;

  //创建资源
  const program_ray_tracing = create_program(gl, vs_default_str, fs_ray_tracing_str);
  const program_display = create_program(gl,vs_default_str,fs_display_str);
  const loc_pos_rt = gl.getAttribLocation(program_ray_tracing, "position");
  const loc_pos_display = gl.getAttribLocation(program_display, "position");
  const loc_tex_rt = gl.getUniformLocation(program_ray_tracing, "tex");
  const loc_tex_display = gl.getUniformLocation(program_display, "tex");
  const loc_iFrame = gl.getUniformLocation(program_ray_tracing, "iFrame");
  const loc_maxFrame = gl.getUniformLocation(program_ray_tracing, "maxFrame");
  const loc_ca = gl.getUniformLocation(program_ray_tracing, "ca");


  //...
  const vbo = gl.createBuffer();
  const fbo = gl.createFramebuffer();
  const tex0 = create_texture(gl); //将要绑定到TEXTURE0
  const tex1 = create_texture(gl); //将要绑定到fbo

  gl.bindTexture(gl.TEXTURE_2D,tex0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    tex1,
    0
  );
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  gl.vertexAttribPointer(loc_pos_rt, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(loc_pos_rt);
  gl.vertexAttribPointer(loc_pos_display, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(loc_pos_display);
  gl.useProgram(program_ray_tracing);
  gl.uniform1i(loc_tex_rt,0);
  gl.uniform1ui(loc_iFrame,0);
  gl.uniform1ui(loc_maxFrame,nsamples);
  gl.uniformMatrix3fv(loc_ca, false, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  gl.useProgram(program_display);
  gl.uniform1i(loc_tex_display,0);
  //
  document.body.appendChild(canvas);
  let i = 0;
  const update = () => {
    if (i >= nsamples) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.useProgram(program_ray_tracing);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    //将tex1 copy 到 tex0, 为了累积采样光线
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, width, height);
    gl.uniform1ui(loc_iFrame, ++i);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program_display);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  
  setInterval(update, 0);
  
  const update_camera = ()=>{
      //更新相机矩阵
      const y = (yaw / 180.0) * 3.14159265;
      const p = (pitch / 180.0) * 3.14159265;
      const front = [
        -Math.cos(y) * Math.cos(p),
        -Math.sin(p),
        -Math.sin(y) * Math.cos(p),
      ];
      let up = [0.0, 1.0, 0.0];
      const right = normalize(cross(front, up));
      up = cross(right, front);
      const ca = [...right, ...up, ...front];
      gl.useProgram(program_ray_tracing);
      gl.uniformMatrix3fv(loc_ca, false, ca);
      //重新开始渲染
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      i = 0;
  }

  canvas.onmousemove = e=>{
    if (e.buttons == 1) {
      //移动摄像机
      //...
      yaw += e.movementX;
      pitch += e.movementY;
      pitch = Math.max(Math.min(89, pitch), -89);
      update_camera();
    }
  }
}
