(function(){
"use strict";
function readLeb(bytes,pos){let n=0,shift=0,b;do{if(pos>=bytes.length)throw Error("Invalid WASM LEB");b=bytes[pos++];n+=(b&127)*Math.pow(2,shift);shift+=7;if(shift>42)throw Error("WASM LEB overflow")}while(b&128);return [n,pos]}
function encLeb(n){const a=[];do{let b=n&127;n=Math.floor(n/128);a.push(n?b|128:b)}while(n);return Uint8Array.from(a)}
function patchFunction(body){
const patterns=[
[[16,189,21,34,2],[65,128,224,251,255,7,32,2,54,2,0]],
[[16,253,28,34,2],[65,132,224,251,255,7,32,2,54,2,0]]
];
const spots=patterns.map(([sig,code])=>{let hits=0,idx=-1;for(let k=0;k<=body.length-sig.length;k++){let ok=true;for(let j=0;j<sig.length;j++)if(body[k+j]!==sig[j]){ok=false;break}if(ok){hits++;idx=k+sig.length}}if(hits!==1)throw Error("Expected one CreateDevice signature, got "+hits);return{idx,code:Uint8Array.from(code)}}).sort((a,b)=>a.idx-b.idx);
const result=new Uint8Array(body.length+22);let from=0,to=0;for(const sp of spots){result.set(body.subarray(from,sp.idx),to);to+=sp.idx-from;result.set(sp.code,to);to+=sp.code.length;from=sp.idx}result.set(body.subarray(from),to);return result;
}
window.bo1zPatchD3DTrace=function(input){
const src=new Uint8Array(input);if(src.length<8||src[0]!==0||src[1]!==97||src[2]!==115||src[3]!==109)throw Error("Not WASM");
const chunks=[src.subarray(0,8)];let total=8,pos=8,patched=false;
function add(v){chunks.push(v);total+=v.length}
while(pos<src.length){
const beginning=pos,id=src[pos++],head=readLeb(src,pos),end=head[1]+head[0];if(end>src.length)throw Error("WASM section truncated");
if(id===10){
let cur=head[1],h=readLeb(src,cur),count=h[0];cur=h[1];if(count!==11523)throw Error("Unexpected function count "+count);
const entries=[encLeb(count)];let codeSize=entries[0].length;
for(let i=0;i<count;i++){
const ln=readLeb(src,cur),start=ln[1],finish=start+ln[0];if(finish>end)throw Error("Bad WASM function");
let entry;
if(i===3929){const body=patchFunction(src.subarray(start,finish)),size=encLeb(body.length);entry=[size,body];patched=true}
else entry=[src.subarray(cur,finish)];
for(const x of entry){entries.push(x);codeSize+=x.length}cur=finish;
}
if(cur!==end)throw Error("Bad code section end");
add(Uint8Array.of(id));add(encLeb(codeSize));for(const entry of entries)add(entry);
}else add(src.subarray(beginning,end));
pos=end;
}
if(!patched)throw Error("CreateDevice not found");
const out=new Uint8Array(total);let p=0;for(const chunk of chunks){out.set(chunk,p);p+=chunk.length}
if(out.length-src.length!==22)throw Error("Unexpected patched size");
return out.buffer;
};
})();