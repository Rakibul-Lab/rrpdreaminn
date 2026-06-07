module.exports=[886885,e=>{"use strict";async function r(e){let r=URL.createObjectURL(e);return new Promise((e,o)=>{let t=new Image;t.onload=()=>{URL.revokeObjectURL(r),e(t)},t.onerror=()=>{URL.revokeObjectURL(r),o(Error("Failed to load image"))},t.src=r})}e.s(["fileToImageElement",0,r])}];

//# sourceMappingURL=src_lib_id-image-preprocess_ts_12oltok._.js.map