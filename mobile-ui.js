(function() {
  if(!new URLSearchParams(location.search).has('mobile') && !matchMedia('(pointer: coarse)').matches) return;
  document.documentElement.classList.add('mobile');
  const style=document.createElement('link');style.rel='stylesheet';style.href='mobile.css';document.head.append(style);
  const viewport=document.createElement('meta');viewport.name='viewport';viewport.content='width=device-width, initial-scale=1, viewport-fit=cover';document.head.append(viewport);
  const canvas=document.getElementById('canvas');
  const pick=document.getElementById('pick');pick.textContent='Stáhnout Kino a spustit';
  const panel=document.createElement('div');panel.id='mobile-controls';
  panel.innerHTML='<div id="move-pad"><span></span></div><div id="look-pad"></div><div id="mobile-actions">'+
    '<button data-key="-1">STŘELBA</button><button data-key="-2">MÍŘENÍ</button>'+
    '<button data-key="114">PŘEBÍT</button><button data-key="102">POUŽÍT</button>'+
    '<button data-key="32">SKOK</button><button data-key="99">DŘEP</button>'+
    '<button data-key="1073742049">BĚH</button><button data-key="49">ZBRAŇ 1</button>'+
    '<button data-key="50">ZBRAŇ 2</button><button data-key="27">MENU</button>'+
    '</div><div id="mobile-rotate">Otoč telefon na šířku</div>';
  document.body.append(panel);
  const info=document.createElement('p');info.id='mobile-info';
  info.textContent='První stažení: přibližně 888 MiB. Data zůstanou uložená v telefonu. Experimentální Zombies port; hratelnost na iPhonu zatím není ověřená.';
  pick.parentElement.append(info);
  const keys=new KBMobileKeys.KeyOwners((key,down)=> {if(Module._KBMobile_Key) Module._KBMobile_Key(key,Number(down));});
  let motionPointer=null, movePointer=null, previous=null, lookStart=null;
  const buttonHolds=[];
  const reset=()=>{buttonHolds.forEach(held=>held.clear());panel.querySelectorAll("button.active").forEach(btn=>btn.classList.remove("active"));keys.clear();motionPointer=movePointer=null;previous=null;lookStart=null; if(Module._KBMobile_Reset) Module._KBMobile_Reset();panel.querySelector('#move-pad span').style.transform='translate(0,0)';};
  window.addEventListener('blur',reset);window.addEventListener('pagehide',reset);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)reset();});
  const init=()=>{Module._KBMobile_Enable(1);};
  if(Module.calledRun) init(); else {const old=Module.onRuntimeInitialized;Module.onRuntimeInitialized=()=>{old?.();init();};}
  const move=panel.querySelector('#move-pad');const thumb=move.querySelector('span');
  function updateMove(e) {
    const r=move.getBoundingClientRect(), x=(e.clientX-r.left-r.width/2)/(r.width/2), y=(e.clientY-r.top-r.height/2)/(r.height/2);
    const v=[];if(x<-.22)v.push(97);if(x>.22)v.push(100);if(y<-.22)v.push(119);if(y>.22)v.push(115);
    keys.set('move',v);const n=Math.max(1,Math.hypot(x,y));thumb.style.transform=`translate(${x/n*35}px,${y/n*35}px)`;
  }
  move.onpointerdown=e=>{if(movePointer!==null)return;e.preventDefault();movePointer=e.pointerId;move.setPointerCapture(e.pointerId);updateMove(e);};
  move.onpointermove=e=>{if(e.pointerId===movePointer)updateMove(e);};
  const stopMove=e=>{if(e.pointerId!==movePointer)return;movePointer=null;keys.set('move',[]);thumb.style.transform='translate(0,0)';};
  move.onpointerup=move.onpointercancel=move.onlostpointercapture=stopMove;
  const look=panel.querySelector('#look-pad');
  function position(e) { const r=canvas.getBoundingClientRect(); if(r.width && r.height)Module._KBMobile_Pointer?.(Math.round((e.clientX-r.left)*canvas.width/r.width),Math.round((e.clientY-r.top)*canvas.height/r.height)); }
  look.onpointerdown=e=>{if(motionPointer!==null)return;e.preventDefault();motionPointer=e.pointerId;previous=[e.clientX,e.clientY];lookStart=[e.clientX,e.clientY,performance.now()];look.setPointerCapture(e.pointerId);position(e);};
  look.onpointermove=e=>{if(e.pointerId!==motionPointer||!previous)return;position(e);Module._KBMobile_Look?.((e.clientX-previous[0])*.8,(e.clientY-previous[1])*.8);previous=[e.clientX,e.clientY];};
  const stopLook=e=>{if(e.pointerId!==motionPointer)return;
    if(e.type==='pointerup' && lookStart && performance.now()-lookStart[2]<250 && Math.hypot(e.clientX-lookStart[0],e.clientY-lookStart[1])<8) {
      const source='tap:'+e.pointerId;keys.set(source,[-1]);setTimeout(()=>keys.set(source,[]),80);
    }
    motionPointer=null;previous=lookStart=null;
  };
  look.onpointerup=look.onpointercancel=look.onlostpointercapture=stopLook;
  for(const btn of panel.querySelectorAll('button')) {
    const held=new Set();buttonHolds.push(held);
    btn.onpointerdown=e=>{e.preventDefault();btn.setPointerCapture(e.pointerId);held.add(e.pointerId);keys.set('button:'+e.pointerId,[Number(btn.dataset.key)]);btn.classList.add('active');};
    const release=e=>{keys.set('button:'+e.pointerId,[]);held.delete(e.pointerId);if(!held.size)btn.classList.remove('active');};
    btn.onpointerup=btn.onpointercancel=btn.onlostpointercapture=release;
  }
  // Single-file selection works without the desktop Directory Picker API.
  // Preserve directory paths if supplied; infer only standard base-game locations.
  Module.KBFS.pickFolder=()=>new Promise((resolve,reject)=>{
    const input=document.createElement('input');input.type='file';input.multiple=true;input.accept='.iwd,.ff,.txt,.cfg,.csv';
    input.oncancel=()=>reject(new Error('Výběr byl zrušen.'));
    input.onchange=()=>{
      const fs=Module.KBFS;fs.index.clear();fs.dirs.clear();
      for(const file of input.files) {
        const n=file.name.toLowerCase();let path=file.webkitRelativePath;
        if(path)path=path.split('/').slice(1).join('/');
        else path=n.endsWith('.iwd')?'main/'+n:n.endsWith('.ff')?(n.startsWith('en_')?'zone/english/':'zone/common/')+n:n;
        const norm=fs.norm(path);fs.index.set(norm,file);
        const parts=norm.split('/');for(let i=1;i<parts.length;i++)fs.dirs.add(parts.slice(0,i).join('/'));
      }
      fs.rootName='local-game-files';fs.ready=fs.index.size>0;
      if(fs.ready)resolve(fs.index.size);else reject(new Error('Nebyly vybrány herní soubory.'));
    };
    input.click();
  });
})();
