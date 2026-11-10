/* ==========================================================================
   Stillwater — shaders
   All GLSL ES 3.0. Sky/water lighting share the COMMON chunk so reflections
   and the dome stay in agreement. Ripple height is applied per-fragment
   (position + normal) so we can raise the mesh resolution without paying for
   a huge vertex-warping cost.
   ========================================================================== */
export const HDR = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\n';

export const COMMON = `
uniform sampler2D uDetail;
uniform float uTime,uStorm,uAmbLum,uSunLum,uCloudLo,uExp;
uniform float uNight,uStars,uAurora;
uniform vec3 uSun,uSunCol,uZenith,uHorizon,uGlow;
float hash12(vec2 p){vec3 p3=fract(vec3(p.xyx)*0.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
/* Milky-way-ish star field: one candidate per cell, power-law brightness. */
vec3 starField(vec3 rd){
  vec3 c=vec3(0.0);
  if(uStars<=0.001) return c;
  vec2 uv=vec2(atan(rd.z,rd.x)*1.2732, asin(clamp(rd.y,-1.0,1.0))*1.2732);
  for(int l=0;l<2;l++){
    float sc=90.0+float(l)*130.0;
    vec2 g=uv*sc;
    vec2 id=floor(g); vec2 f=fract(g)-0.5;
    float h=hash12(id+float(l)*17.3);
    if(h>0.955){
      vec2 o=vec2(hash12(id+3.7),hash12(id+9.1))-0.5;
      float d=length((f-o*0.7))*2.0;
      float mag=pow(hash12(id+1.3),5.0);
      float tw=0.72+0.28*sin(uTime*(1.2+mag*3.0)+h*40.0);
      c+=vec3(0.86,0.92,1.0)*smoothstep(0.55,0.0,d)*(0.35+mag*1.7)*tw;
    }
  }
  /* faint galactic band */
  float band=exp(-pow(dot(rd,normalize(vec3(0.55,0.28,-0.78)))*3.1,2.0));
  float n=texture(uDetail,uv*0.8).a;
  c+=vec3(0.30,0.35,0.52)*band*band*0.16*(0.5+n);
  return c*uStars;
}
/* Low, slow aurora ribbons — only visible when enabled and looking up. */
vec3 aurora(vec3 rd){
  if(uAurora<=0.001||rd.y<0.02) return vec3(0.0);
  vec2 p=vec2(atan(rd.z,rd.x)*0.62, 1.0/max(rd.y,0.06)*0.16);
  float w1=texture(uDetail,vec2(p.x*0.55+uTime*0.006, p.y+uTime*0.004)).a;
  float w2=texture(uDetail,vec2(p.x*1.35-uTime*0.011,p.y*1.9-uTime*0.009)).a;
  float band=exp(-pow((rd.y-0.30-w1*0.20)*4.2,2.0));
  float band2=exp(-pow((rd.y-0.13-w2*0.16)*6.5,2.0));
  float k=fract(w1*3.1+w2*1.7)+0.5*smoothstep(0.45,0.95,w2);
  vec3 c=mix(vec3(0.10,0.85,0.55),vec3(0.25,0.45,1.0),k);
  c=mix(c,vec3(0.85,0.30,0.75),smoothstep(0.72,1.0,w1)*0.5);
  float curtain=0.45+0.55*sin(rd.x*7.0+rd.z*4.0+uTime*0.25);
  return c*(band*0.9+band2*0.55)*smoothstep(0.0,0.25,rd.y)*curtain*uAurora*0.55;
}
vec3 skyCol(vec3 rd,float sunOn){
  float h=max(rd.y,0.0);
  vec3 c=mix(uHorizon,uZenith,pow(h,0.42));
  float sd=max(dot(rd,uSun),0.0);
  c+=uGlow*(pow(sd,5.0)*0.30+pow(sd,48.0)*0.8);
  /* moon: a small cool disc opposite the sun, only at night */
  if(uNight>0.01){
    vec3 m=-uSun*0.92+vec3(0.10,0.16,0.0);
    m=normalize(m);
    float md=max(dot(rd,m),0.0);
    float disc=smoothstep(0.99955,0.99975,md);
    c+=vec3(0.78,0.85,1.0)*disc*1.9*uNight;
    c+=vec3(0.38,0.46,0.72)*pow(md,220.0)*0.55*uNight;
    c+=vec3(0.10,0.13,0.24)*pow(md,8.0)*0.20*uNight;
  }
  {
    vec2 cuv=rd.xz/(h+0.10)*0.20+vec2(uTime*0.0035,uTime*0.0012);
    float n=texture(uDetail,cuv).a*0.65+texture(uDetail,cuv*2.7+vec2(3.1,1.7)).a*0.35;
    float cov=smoothstep(uCloudLo,uCloudLo+0.24,n)*smoothstep(0.0,0.16,rd.y);
    vec3 cc=mix(uHorizon,vec3(1.0),0.65)*(0.5+0.5*uAmbLum);
    cc*=mix(1.0,0.42,uStorm);
    cc+=uGlow*pow(sd,3.0)*0.45;
    c=mix(c,cc,cov*0.92);
    c+=uSunCol*smoothstep(0.99965,0.99985,sd)*(1.0-cov)*step(0.5,sunOn)*step(0.0,rd.y);
    c*=mix(1.0,0.55,cov*0.35*uNight);
  }
  if(rd.y>0.0){
    c+=starField(rd)*(1.0-smoothstep(uCloudLo-0.16,uCloudLo+0.10,texture(uDetail,rd.xz/(h+0.10)*0.20+vec2(uTime*0.0035,uTime*0.0012)).a));
    c+=aurora(rd);
  }
  return c;
}
vec3 tonemap(vec3 x){
  x*=uExp;
  vec3 c=clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0);
  return pow(c,vec3(1.0/2.2));
}
vec3 enc(vec3 c){return c/(1.0+c);}
vec3 dec(vec3 c){c=min(c,vec3(0.995));return c/(1.0-c);}
`;

export const WATER_VS = HDR + `
layout(location=0) in vec2 aUV;
uniform mat4 uVP;
uniform float uTime;
uniform vec4 uW[8];
uniform float uQ[8];
uniform float uRipR;
out vec3 vWorld;
out vec3 vN;
out float vFoam;
out float vWaveY;
void main(){
  /* aUV is a non-uniform grid: it compresses detail towards the camera. */
  vec2 s=sign(aUV); vec2 au=abs(aUV);
  vec2 p0=s*600.0*(exp(6.0*au)-1.0)/(exp(6.0)-1.0);
  float sp=0.0417*(max(abs(p0.x),abs(p0.y))+1.5);
  vec3 disp=vec3(0.0);
  float nx=0.0,nz=0.0,ny=0.0,jxx=0.0,jzz=0.0,jxz=0.0,sumA=0.0;
  for(int i=0;i<8;i++){
    vec4 w=uW[i]; float k=w.z; float L=6.2831853/k;
    float f=smoothstep(1.5*sp,4.5*sp,L);
    float om=sqrt(9.81*k);
    float th=k*dot(w.xy,p0)-om*uTime+float(i)*2.399;
    float sn=sin(th),cs=cos(th);
    float q=uQ[i]*f; float A=w.w*f;
    disp.xz+=w.xy*(q/k)*cs;
    disp.y+=A*sn;
    nx-=w.x*k*A*cs; nz-=w.y*k*A*cs; ny+=q*sn;
    jxx+=q*w.x*w.x*sn; jzz+=q*w.y*w.y*sn; jxz+=q*w.x*w.y*sn;
    sumA+=A;
  }
  vec3 pos=vec3(p0.x+disp.x,disp.y,p0.y+disp.z);
  vWorld=pos;
  vWaveY=disp.y;
  vN=vec3(nx,1.0-ny,nz);
  float J=(1.0-jxx)*(1.0-jzz)-jxz*jxz;
  /* whitecaps: the surface has to be folding *and* near the top of a crest */
  float crest=smoothstep(-0.25,0.55,disp.y/max(sumA,1e-4));
  vFoam=(1.0-smoothstep(0.16,0.62,J))*crest;
  gl_Position=uVP*vec4(pos,1.0);
}`;

/* ---- Water fragment: fresnel, planar reflection, refraction, SSS, foam, glitter.
       Interactive ripples are parallax-corrected per fragment, so the wave
       mesh can stay light while the water still reads as liquid up close.
       Bodies in the water are not painted on: they press a bowl into the
       surface, raise a meniscus, trail a Kelvin wake and gather foam.   ---- */
export const WATER_FS = HDR + COMMON + `
in vec3 vWorld; in vec3 vN; in float vFoam; in float vWaveY;
out vec4 o;
uniform vec3 uCam,uCamR,uCamF;
uniform float uRipR,uRipN,uA0,uClarity,uSparkle,uDetailAmt,uCaustic,uFoamAmt,uWake;
uniform vec2 uRes,uNF;
uniform sampler2D uRip,uScene,uSceneD,uRefl;
uniform vec4 uBallA[16];   /* x, z, radius, submerged fraction */
uniform vec4 uBallB[16];   /* vx, vz, horizontal speed, wake */
uniform int  uBallCount;

/* The V that trails a body moving through the water. */
float wakeH(vec2 rel, vec2 dir, float r, float sp, float t){
  float along=dot(rel,dir);
  if(along>0.0) return 0.0;
  float behind=-along;
  float lat=dot(rel,vec2(-dir.y,dir.x));
  float wid=r*0.34+behind*0.11;
  float kx=abs(lat)-behind*0.354;
  float ridge=exp(-(kx*kx)/(wid*wid))*exp(-behind/(r*5.5));
  float amp=min(sp*0.05,0.20);
  float tw=sin(behind*6.5-t*3.2+lat*1.6)*exp(-behind/(r*2.4))*amp*0.20;
  return ridge*amp+tw;
}
float linZ(float d){float z=2.0*d-1.0;return 2.0*uNF.x*uNF.y/(uNF.y+uNF.x-z*(uNF.y-uNF.x));}
float edgeFade(vec2 ruv){
  return smoothstep(0.0,0.06,min(min(ruv.x,1.0-ruv.x),min(ruv.y,1.0-ruv.y)));
}
void main(){
  vec3 toCam=uCam-vWorld; float dist=length(toCam); vec3 V=toCam/dist;
  vec3 Nw=normalize(vN);
  vec2 s=Nw.xz/max(Nw.y,0.2);

  /* ---- interactive ripples: two-step parallax search along the view ray ---- */
  vec2 ruv=vWorld.xz/(2.0*uRipR)+0.5;
  vec2 ripP=vWorld.xz;
  float rh=0.0, foamSim=0.0;
  for(int i=0;i<2;i++){
    ruv=ripP/(2.0*uRipR)+0.5;
    float ef=edgeFade(ruv);
    vec4 t=textureLod(uRip,clamp(ruv,vec2(0.002),vec2(0.998)),0.0);
    rh=t.r*ef; foamSim=t.g*ef;
    float tt=(vWorld.y+rh-uCam.y)/min(V.y,-2e-3);
    ripP=uCam.xz+V.xz*tt;
  }
  float ef=edgeFade(ruv);
  float e=1.0/uRipN;
  float hl=texture(uRip,ruv-vec2(e,0.0)).r, hr=texture(uRip,ruv+vec2(e,0.0)).r;
  float hd=texture(uRip,ruv-vec2(0.0,e)).r, hu=texture(uRip,ruv+vec2(0.0,e)).r;
  vec2 grad=vec2(hr-hl,hu-hd)*(uRipN/(4.0*uRipR));
  s-=grad*ef*1.35;

  /* ---- bodies in the water: bowl, meniscus, wake, foam ---- */
  vec2 bgrad=vec2(0.0);
  float bdisp=0.0, bfoam=0.0, bao=0.0;
  for(int i=0;i<16;i++){
    if(i>=uBallCount) break;
    vec4 A=uBallA[i]; vec4 B=uBallB[i];
    float r=max(A.z,0.05);
    vec2 rel=vWorld.xz-A.xy;
    float rr=dot(rel,rel);
    if(rr>(r*4.0)*(r*4.0)) continue;
    float d=sqrt(rr);
    float u=d/r;
    vec2 dn=d>1e-4?rel/d:vec2(0.0);
    float sub=A.w;

    /* the bowl the body presses into the surface */
    float kb=2.1;
    float eb=exp(-kb*u*u);
    float bowl=-sub*r*0.62*eb;
    float dbowl=-sub*r*0.62*eb*(-2.0*kb*u/r);
    /* the meniscus climbing the flank */
    float wm=0.34;
    float mu=(u-1.0)/wm;
    float em=exp(-mu*mu);
    float men=sub*r*0.26*em;
    float dmen=sub*r*0.26*em*(-2.0*mu/(wm*r));

    bdisp+=bowl+men;
    bgrad+=dn*(dbowl+dmen);
    bao+=sub*exp(-u*u*0.8);

    /* foam gathered where the body cuts the surface */
    float sp=B.z;
    float tc=(u-1.0)/0.30;
    bfoam+=exp(-tc*tc)*min(sp*0.32,0.9)*(0.30+0.70*sub);

    /* the wake */
    if(sp>0.2){
      vec2 vd=B.xy; float vl=length(vd);
      vec2 dir=vd/max(vl,1e-4);
      vec2 nrm=vec2(-dir.y,dir.x);
      if(dot(rel,dir)<0.0){
        float ew=max(r*0.12,0.02);
        float h0=wakeH(rel,dir,r,sp,uTime);
        float hx=wakeH(rel+nrm*ew,dir,r,sp,uTime);
        float hy=wakeH(rel+dir*ew,dir,r,sp,uTime);
        bdisp+=h0*uWake;
        bgrad+=(nrm*(hx-h0)+dir*(hy-h0))/ew*uWake;
        float lat=dot(rel,nrm);
        float wid=r*0.55+0.05;
        float tw=lat/wid;
        float behind=max(-dot(rel,dir),0.0);
        float trail=exp(-tw*tw)*exp(-behind/(r*4.0));
        bfoam+=trail*min(sp*0.24,0.95)*uWake;
      }
    }
  }
  bfoam=clamp(bfoam,0.0,1.5);
  s-=bgrad;

  /* ---- capillary detail, faded with distance to keep it stable ---- */
  float df=1.0/(1.0+dist*0.030);
  vec2 t1=vWorld.xz*0.23+vec2(uTime*0.031,uTime*0.017);
  vec2 t2=vWorld.xz*0.61+vec2(-uTime*0.047,uTime*0.029);
  vec2 t3=vWorld.xz*1.70+vec2(uTime*0.071,-uTime*0.050);
  vec3 d1=texture(uDetail,t1).xyz*2.0-1.0;
  vec3 d2=texture(uDetail,t2).xyz*2.0-1.0;
  vec3 d3=texture(uDetail,t3).xyz*2.0-1.0;
  float dw=(0.34+0.60*uStorm)*df*uDetailAmt;
  s+=(d1.xz*0.85+d2.xz*0.62+d3.xz*0.32)*dw;
  s*=mix(1.0,0.5,smoothstep(60.0,400.0,dist));

  /* ---- foam field: breaking crests, wakes and trails ---- */
  float foamAmt=clamp(vFoam*1.15+foamSim*1.15*uFoamAmt+bfoam*uFoamAmt,0.0,1.6);
  float fn=texture(uDetail,vWorld.xz*0.55+vec2(uTime*0.010,-uTime*0.013)).a*0.62
          +texture(uDetail,vWorld.xz*1.90-vec2(uTime*0.020,0.0)).a*0.38;
  float thr=1.04-foamAmt*0.74;
  float fm=smoothstep(thr,thr+0.26,fn);
  float bub=texture(uDetail,vWorld.xz*3.60+vec2(-uTime*0.026,uTime*0.031)).a;
  fm+=smoothstep(0.66,0.93,bub)*min(foamAmt,1.0)*0.30;
  fm=clamp(fm,0.0,1.0);
  /* foam is froth: it breaks the surface up */
  float fr1=texture(uDetail,vWorld.xz*2.20+vec2(uTime*0.048,uTime*0.011)).a;
  float fr2=texture(uDetail,vWorld.xz*2.20+vec2(-uTime*0.017,-uTime*0.043)).a;
  s+=vec2(fr1-0.5,fr2-0.5)*fm*0.42;

  vec3 N=normalize(vec3(s.x,1.0,s.y));
  float nv=max(dot(N,V),0.0);
  float F=0.02+0.98*pow(1.0-nv,5.0);
  float surfY=vWorld.y+rh+bdisp;

  /* ---- reflection: analytic sky + mirrored geometry ---- */
  vec3 R=reflect(-V,N); R.y=abs(R.y);
  vec3 refl=skyCol(R,0.0);
  vec2 uv=gl_FragCoord.xy/uRes;
  vec2 off=vec2(dot(s,uCamR.xz),dot(s,normalize(uCamF.xz))*0.6);
  vec4 rb=texture(uRefl,clamp(uv+off*0.05,0.001,0.999));
  refl=mix(refl,dec(rb.rgb),rb.a);

  /* ---- body colour with sub-surface scattering at the crests ---- */
  vec3 L=uSun;
  float hh=clamp((surfY-vWaveY)/(uA0*2.0+0.35)*0.5+0.55,0.0,1.0);
  float back=pow(clamp(dot(L,-V)*0.5+0.5,0.0,1.0),3.0);
  float aoTrough=mix(0.86,1.0,smoothstep(-uA0*1.3,uA0*1.3,vWaveY));
  vec3 deep=vec3(0.004,0.034,0.070);
  vec3 tq=vec3(0.04,0.40,0.34);
  vec3 body=deep*(0.22+0.95*uAmbLum)
           +tq*uSunCol*back*hh*hh*0.34*clamp(L.y*2.5,0.0,1.0)
           +tq*0.055*uAmbLum*pow(1.0-nv,2.0)*(0.4+hh)
           +vec3(0.0,0.055,0.065)*uAmbLum*hh;
  body*=mix(vec3(1.0),uHorizon*1.4,0.25);
  body*=aoTrough;

  /* ---- refraction of submerged geometry ---- */
  float zW=linZ(gl_FragCoord.z);
  vec3 refr=body;
  vec2 uvq=clamp(uv+off*0.03,0.001,0.999);
  vec4 sc=vec4(0.0); float zS=0.0;
  vec4 c2=textureLod(uScene,uvq,0.0); float z2=linZ(textureLod(uSceneD,uvq,0.0).r);
  vec4 c1=textureLod(uScene,uv,0.0);  float z1=linZ(textureLod(uSceneD,uv,0.0).r);
  if(c2.a>0.5&&z2>zW){sc=c2;zS=z2;}
  else if(c1.a>0.5&&z1>zW){sc=c1;zS=z1;}
  if(sc.a>0.5){
    float thick=max(zS-zW,0.0)*dist/zW;
    /* clarity: murkier water absorbs faster */
    float absorb=mix(1.7,0.55,uClarity);
    vec3 tr=exp(-thick*vec3(0.42,0.10,0.060)*absorb*(0.8+0.5*uStorm));
    vec3 tint=mix(body*0.7,body*1.15,uClarity);
    /* a little dispersion: red bends less than blue */
    vec3 rc=dec(texture(uScene,clamp(uvq+off*0.036,vec2(0.001),vec2(0.999))).rgb);
    vec3 bc=dec(texture(uScene,clamp(uvq-off*0.036,vec2(0.001),vec2(0.999))).rgb);
    vec3 gc=dec(sc.rgb);
    refr=vec3(rc.r,gc.g,bc.b)*tr+tint*(1.0-tr);
  }

  vec3 col=mix(refr,refl,F);
  /* the body shades the water it sits in */
  col*=mix(1.0,clamp(1.0-bao*0.55,0.0,1.0),0.6);

  /* ---- sun glitter (GGX) ---- */
  vec3 H=normalize(L+V);
  float nh=max(dot(N,H),0.0);
  float a=0.032+0.07*uStorm+dist*0.00022; float a2=a*a;
  float dd=nh*nh*(a2-1.0)+1.0;
  float D=a2/(3.14159265*dd*dd);
  float vh=max(dot(V,H),0.0);
  float Fs=0.02+0.98*pow(1.0-vh,5.0);
  float nl=max(dot(N,L),0.0);
  vec3 spec=uSunCol*min(D*Fs/(4.0*max(nv,0.08)),22.0)*smoothstep(0.0,0.12,nl)*step(0.0,L.y);
  spec*=uSparkle;

  /* ---- foam: breaking crests + object wakes ---- */
  float foamLight=0.50*uAmbLum+0.30*uSunLum*max(dot(N,L),0.0);
  vec3 foamCol=vec3(0.95,0.98,1.0)*foamLight;
  col=mix(col+spec*(1.0-fm),foamCol,fm*0.94);

  /* ---- optional caustic shimmer: refocused light on the water body ---- */
  if(uCaustic>0.001){
    vec2 cue=vWorld.xz*0.55+vec2(uTime*0.014,-uTime*0.011);
    float c1=texture(uDetail,cue).a;
    float c2=texture(uDetail,cue*1.83+vec2(-uTime*0.021,0.31)).a;
    float ca=smoothstep(0.52,0.86,c1*c2*3.1);
    float near=smoothstep(90.0,14.0,dist);
    col+=vec3(0.42,0.72,0.66)*ca*near*uCaustic*(0.35+0.65*uSunLum*0.3);
  }

  /* ---- horizon haze ---- */
  float fog=smoothstep(110.0,600.0,dist);
  vec3 hd2=normalize(vec3(vWorld.x-uCam.x,0.02,vWorld.z-uCam.z));
  col=mix(col,skyCol(hd2,0.0),fog);

  vec3 outc=tonemap(col)+(hash12(gl_FragCoord.xy)-0.5)/255.0;
  o=vec4(outc,1.0);
}`;

/* ---- Sky ---- */
export const SKY_VS = HDR + `
out vec2 vNdc;
void main(){
  vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));
  vNdc=p*2.0-1.0;
  gl_Position=vec4(vNdc,1.0,1.0);
}`;
export const SKY_FS = HDR + COMMON + `
in vec2 vNdc; out vec4 o;
uniform vec3 uCamF,uCamR,uCamU; uniform vec2 uTanAsp;
void main(){
  vec3 rd=normalize(uCamF+vNdc.x*uTanAsp.x*uTanAsp.y*uCamR+vNdc.y*uTanAsp.x*uCamU);
  vec3 c=skyCol(rd,1.0);
  o=vec4(tonemap(c)+(hash12(gl_FragCoord.xy)-0.5)/255.0,1.0);
}`;

/* ---- Balls ---- */
export const BALL_VS = HDR + `
layout(location=0) in vec3 aPos;
uniform mat4 uVP; uniform vec3 uPos; uniform float uR; uniform mat3 uRot;
uniform float uMirror,uPlane;
out vec3 vWorld; out vec3 vWN; out vec3 vLocal;
void main(){
  vec3 wl=uRot*aPos;
  vec3 w=uPos+wl*uR;
  vLocal=aPos; vWN=wl; vWorld=w;
  if(uMirror>0.5) w.y=2.0*uPlane-w.y;
  gl_Position=uVP*vec4(w,1.0);
}`;
export const BALL_FS = HDR + COMMON + `
in vec3 vWorld; in vec3 vWN; in vec3 vLocal;
out vec4 o;
uniform vec3 uCamEff; uniform float uType,uMode,uMirror,uPlane;
const vec3 BC[6]=vec3[6](vec3(0.85,0.07,0.08),vec3(0.96,0.96,0.94),vec3(0.06,0.25,0.85),vec3(0.98,0.80,0.10),vec3(0.96,0.96,0.94),vec3(0.07,0.62,0.22));
vec2 dn(vec2 uv){vec3 d=texture(uDetail,uv).xyz*2.0-1.0;return d.xz;}
void main(){
  if(uMirror>0.5&&vWorld.y<uPlane) discard;
  vec3 l=normalize(vLocal);
  vec3 N=normalize(vWN);
  vec3 alb=vec3(0.8); float rough=0.4,metal=0.0,f0=0.04; vec2 bn=vec2(0.0);
  int t=int(uType+0.5);
  if(t==0){
    float a=atan(l.z,l.x); float seg=(a+3.14159265)/6.2831853*6.0;
    float id=floor(seg); float fr=fract(seg);
    alb=BC[int(mod(id,6.0))];
    float seam=smoothstep(0.0,0.035,fr)*(1.0-smoothstep(0.965,1.0,fr));
    alb*=mix(0.5,1.0,seam);
    float cap=smoothstep(0.86,0.9,abs(l.y)); alb=mix(alb,vec3(0.95),cap);
    float ring=smoothstep(0.972,0.978,abs(l.y))*(1.0-smoothstep(0.99,0.996,abs(l.y)));
    alb=mix(alb,vec3(0.15),ring*0.6);
    rough=0.28;
  } else if(t==1){
    float pb=(texture(uDetail,l.xy*6.0).a+texture(uDetail,l.zy*6.0).a)*0.5;
    alb=vec3(0.86,0.37,0.07)*(0.82+0.34*pb);
    bn=(dn(l.xy*7.0)+dn(l.zy*7.0))*0.18;
    float w=0.020;
    float d=min(min(abs(l.y),abs(l.x)),abs(abs(l.z)-0.62)*1.1);
    alb=mix(alb,vec3(0.02),1.0-smoothstep(w,w+0.012,d));
    rough=0.62;
  } else if(t==2){
    float fz=texture(uDetail,l.xy*14.0).a*0.5+texture(uDetail,l.zy*14.0).a*0.5;
    alb=vec3(0.76,0.90,0.16)*(0.78+0.4*fz);
    bn=(dn(l.xy*16.0)+dn(l.zy*16.0))*0.3;
    float d=abs(l.y-0.62*sin(2.0*atan(l.z,l.x)))*0.85;
    alb=mix(alb,vec3(0.93,0.95,0.88),(1.0-smoothstep(0.035,0.06,d))*0.92);
    rough=0.95;
  } else if(t==3){
    float n=texture(uDetail,l.xz*1.3+0.3).a;
    float r=length(l.xz)+0.06*n;
    float rings=0.5+0.5*sin(r*34.0+n*4.0);
    alb=mix(vec3(0.40,0.22,0.08),vec3(0.66,0.43,0.20),rings);
    alb*=0.9+0.2*texture(uDetail,l.xy*9.0).a;
    rough=0.42;
  } else if(t==4){
    float n=texture(uDetail,l.xy*1.4+vec2(0.3)).a+texture(uDetail,l.zy*1.1).a;
    alb=mix(vec3(0.01,0.02,0.12),vec3(0.28,0.04,0.46),smoothstep(0.5,1.3,n));
    alb+=vec3(0.0,0.0,0.15)*smoothstep(0.9,1.1,n);
    vec3 d0=normalize(vec3(0.0,0.9,0.43)); vec3 d1=normalize(vec3(0.17,0.82,0.55)); vec3 d2=normalize(vec3(-0.17,0.82,0.55));
    float hole=max(max(smoothstep(0.9935,0.9945,dot(l,d0)),smoothstep(0.9965,0.9975,dot(l,d1))),smoothstep(0.9965,0.9975,dot(l,d2)));
    alb=mix(alb,vec3(0.0),hole);
    rough=0.09;
  } else {
    alb=vec3(0.86,0.89,0.94); metal=1.0; rough=0.05; f0=0.9;
  }
  if(bn!=vec2(0.0)){
    vec3 T=normalize(cross(N,vec3(0.31,0.93,0.17))); vec3 B=cross(N,T);
    N=normalize(N+T*bn.x+B*bn.y);
  }
  vec3 V=normalize(uCamEff-vWorld);
  float nv=max(dot(N,V),0.0);
  float ndl=max(dot(N,uSun),0.0);
  vec3 hemi=mix(uHorizon*0.45+vec3(0.02,0.05,0.07),uZenith*1.3+vec3(0.05),N.y*0.5+0.5);
  vec3 diff=alb*(uSunCol*ndl*0.5+hemi*1.25);
  float shin=clamp(2.0/(rough*rough)-2.0,4.0,3000.0);
  vec3 H=normalize(uSun+V); float nh=max(dot(N,H),0.0);
  float vh=max(dot(V,H),0.0);
  vec3 F0v=mix(vec3(f0),alb,metal);
  vec3 Fh=F0v+(1.0-F0v)*pow(1.0-vh,5.0);
  vec3 spec=pow(nh,shin)*(shin+8.0)/(8.0*3.14159)*Fh*ndl*uSunCol*0.45;
  vec3 R=reflect(-V,N);
  vec3 env;
  if(R.y>=0.0) env=skyCol(R,1.0);
  else env=mix(vec3(0.02,0.07,0.10)*uAmbLum+uHorizon*0.08,uHorizon*0.5,smoothstep(-0.25,0.0,R.y));
  vec3 Fr=F0v+(1.0-F0v)*pow(1.0-nv,5.0);
  float gloss=(1.0-rough); gloss*=gloss;
  vec3 col=diff*(1.0-metal)*(1.0-Fr*gloss*0.5)+env*Fr*gloss+spec*mix(vec3(1.0),alb,metal);
  if(uMode>0.5) o=vec4(enc(col),1.0);
  else o=vec4(tonemap(col),1.0);
}`;

/* ---- Spray particles: heavy droplets, drifting mist and sheets of foam ---- */
export const PART_VS = HDR + `
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aInfo;
uniform mat4 uVP; uniform float uPx;
out float vA; flat out int vKind;
void main(){
  vec4 c=uVP*vec4(aPos,1.0);
  gl_Position=c;
  gl_PointSize=clamp(aInfo.x*uPx/max(c.w,0.1),1.5,72.0);
  vA=aInfo.y;
  vKind=int(aInfo.z+0.5);
}`;
export const PART_FS = HDR + COMMON + `
in float vA; flat in int vKind; out vec4 o;
void main(){
  vec2 q=gl_PointCoord*2.0-1.0; float d=dot(q,q);
  if(d>1.0) discard;
  if(vKind==1){
    /* mist: soft, wide, almost transparent */
    float a=exp(-d*2.4)*vA*0.55;
    vec3 c=vec3(0.86,0.92,1.0)*(0.42*uAmbLum+0.20*uSunLum);
    o=vec4(tonemap(c),a);
  } else if(vKind==2){
    /* a sheet of foam torn off the surface */
    float a=(1.0-d)*vA;
    float b=texture(uDetail,q*0.5+0.5).a;
    a*=0.25+0.75*smoothstep(0.12,0.72,b);
    vec3 c=vec3(0.95,0.98,1.0)*(0.52*uAmbLum+0.30*uSunLum);
    o=vec4(tonemap(c),a);
  } else {
    /* a droplet: bright rim, dark middle */
    float a=(1.0-d)*vA;
    vec3 c=vec3(0.9,0.95,1.0)*(0.45*uAmbLum+0.22*uSunLum);
    c+=uSunCol*0.55*smoothstep(0.35,-0.55,q.y+q.x*0.28);
    o=vec4(tonemap(c),a*(0.55+0.45*uAmbLum));
  }
}`;
