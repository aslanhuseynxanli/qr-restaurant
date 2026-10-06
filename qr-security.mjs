const headers=[
  {key:"X-Content-Type-Options",value:"nosniff"},
  {key:"X-Frame-Options",value:"DENY"},
  {key:"Referrer-Policy",value:"strict-origin"},
  {key:"Permissions-Policy",value:"camera=(), microphone=(), geolocation=(self)"},
];
export function withQRSecurity(config) {
  if(typeof config==="function")return async(...args)=>withQRSecurity(await config(...args));
  const base=config||{};
  return {...base,async headers(){return [...(base.headers?await base.headers.call(base):[]),{source:"/:path*",headers}];}};
}
