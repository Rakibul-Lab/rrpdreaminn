module.exports=[153095,a=>{"use strict";async function b(a){let b=URL.createObjectURL(a);return new Promise((a,c)=>{let d=new Image;d.onload=()=>{URL.revokeObjectURL(b),a(d)},d.onerror=()=>{URL.revokeObjectURL(b),c(Error("Failed to load image"))},d.src=b})}a.s(["fileToImageElement",0,b])}];

//# sourceMappingURL=src_lib_id-image-preprocess_ts_073bpz3._.js.map