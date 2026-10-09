// BO1Z WebGL Compatibility v1: in-memory normalization of D3D presentation parameters
(function(){
'use strict';
function rd(bytes,pos){let n=0,k=0,b;do{if(pos>=bytes.length||k>35)throw Error('Invalid WASM LEB');b=bytes[pos++];n+=(b&127)*2**k;k+=7}while(b&128);return [n,pos]}
function leb(num){let a=[];do{let v=num&127;num=Math.floor(num/128);a.push(num?v|128:v)}while(num);return Uint8Array.from(a)}
function signed(num){let a=[];while(true){const v=num&127;num>>=7;const end=(num===0&&(v&64)===0)||(num===-1&&(v&64)!==0);a.push(end?v:v|128);if(end)return a}}
const settings=[[28,0],[32,1],[44,0],[48,0],[16,0],[20,0],[24,1],[12,1],[52,0]];
const op=[];for(const [off,value] of settings)op.push(0x20,0,0x41,...signed(value),0x36,0x02,...leb(off));const insert=Uint8Array.from(op);
function patch(buffer){
 const src=new Uint8Array(buffer);
 if(src.length<8||src[0]!==0||src[1]!==97||src[2]!==115||src[3]!==109)throw Error('Not WebAssembly');
 const chunks=[src.subarray(0,8)];let size=8,pos=8,done=false;
 function push(v){chunks.push(v);size+=v.length}
 while(pos<src.length){const at=pos,id=src[pos++],r=rd(src,pos),end=r[1]+r[0];if(end>src.length)throw Error('WASM section truncated');
  if(id!==10){push(src.subarray(at,end));pos=end;continue}
  let cursor=r[1],h=rd(src,cursor),count=h[0];cursor=h[1];
  if(count!==11523)throw Error('Unsupported game build; original preserved ('+count+' functions)');
  const code=[leb(count)];let codeSize=code[0].length;
  for(let i=0;i<count;i++){const bodyHeader=rd(src,cursor),bodyStart=bodyHeader[1],bodyEnd=bodyStart+bodyHeader[0];if(bodyEnd>end)throw Error('Function out of bounds');
   if(i===2579){const orig=src.subarray(bodyStart,bodyEnd),first=rd(orig,0);let p=first[1];for(let j=0;j<first[0];j++){p=rd(orig,p)[1]+1;if(p>orig.length)throw Error('Invalid local declarations')}
    const signature=[0x23,0,0x41,0xf0,0];if(!signature.every((v,j)=>orig[p+j]===v))throw Error('Unexpected ValidatePresentation signature; original preserved');
    const n=new Uint8Array(orig.length+insert.length);n.set(orig.subarray(0,p));n.set(insert,p);n.set(orig.subarray(p),p+insert.length);
    const len=leb(n.length);code.push(len,n);codeSize+=len.length+n.length;done=true;
   }else{const original=src.subarray(cursor,bodyEnd);code.push(original);codeSize+=original.length}
   cursor=bodyEnd;
  }
  if(cursor!==end)throw Error('Unrecognized WASM code trailing bytes');
  push(Uint8Array.of(id));push(leb(codeSize));for(const c of code)push(c);pos=end;
 }
 if(!done||size!==src.length+insert.length)throw Error('Patch validation failed');
 const out=new Uint8Array(size);let cursor=0;for(const c of chunks){out.set(c,cursor);cursor+=c.length}
 return out.buffer;
}
if(typeof window!=='undefined')window.bo1zWebGLCompat=patch;
if(typeof module!=='undefined')module.exports=patch;
})();