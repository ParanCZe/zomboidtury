(function(root) {
  class KeyOwners {
    constructor(send) { this.send=send; this.sources=new Map(); }
    set(source, values) {
      const before=new Set([...this.sources.values()].flatMap(s=>[...s]));
      if(values.length) this.sources.set(source,new Set(values)); else this.sources.delete(source);
      const after=new Set([...this.sources.values()].flatMap(s=>[...s]));
      for(const key of before) if(!after.has(key)) this.send(key,false);
      for(const key of after) if(!before.has(key)) this.send(key,true);
    }
    clear() { for(const key of new Set([...this.sources.values()].flatMap(s=>[...s]))) this.send(key,false); this.sources.clear(); }
  }
  if(typeof module==='object' && module.exports) module.exports={KeyOwners};
  else root.KBMobileKeys={KeyOwners};
})(typeof window==='object'?window:globalThis);
