'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

test('map selection is shown without downloads; Kino Start applies settings and begins exactly one download',()=>{
  const nodes=new Map();
  function node(id) {
    const element={
      id,hidden:false,disabled:false,value:'',textContent:'',dataset:{},
      options:[],listeners:{},attrs:{},
      addEventListener(type,fn){this.listeners[type]=fn;},
      setAttribute(k,v){this.attrs[k]=String(v);},
      getAttribute(k){return this.attrs[k];},
      click(){this.listeners.click?.();}
    };
    nodes.set(id,element);
    return element;
  }
  const menu=node('bo1z-menu'), pick=node('pick'), status=node('status'),
        home=node('bm-home'), loading=node('bm-loading'),
        progress=node('bm-progress'),start=node('bm-start');
  node('bm-back');node('bm-show');node('bm-cancel');
  let downloads=0;pick.click=()=>downloads++;
  loading.hidden=true;
  const choices={
    resolution:['640x360','960x540','1280x720'],
    fps:['30','45','60'],
    textures:['standard','high'],
    audio:['on','off']
  };
  for(const [id,values] of Object.entries(choices)){
    const n=node('bm-'+id);n.options=values.map(value=>({value}));n.value=values[0];
  }
  const maps=[node('kino'),node('five'),node('ascension')];
  maps[0].dataset.map='zombie_theater';maps[0].attrs['aria-pressed']='true';
  maps[1].dataset.map='zombie_pentagon';maps[1].disabled=true;
  maps[2].dataset.map='zombie_cosmodrome';maps[2].disabled=true;
  const mapView=node('maps'),settingsView=node('settings');
  mapView.dataset.page='maps';settingsView.dataset.page='settings';
  const tabs=[node('tab-maps'),node('tab-settings')];
  tabs[0].dataset.view='maps';tabs[1].dataset.view='settings';
  menu.querySelectorAll=(selector)=>({
    '[data-page]':[mapView,settingsView],
    '[data-view]':tabs,
    '.bm-map:not(:disabled)':[maps[0]],
    '.bm-map':maps
  }[selector]||[]);
  menu.querySelector=(selector)=>{
    if(selector==='.bm-map[aria-pressed="true"]')
      return maps.find(m=>m.attrs['aria-pressed']==='true');
    return null;
  };
  let updatedUrl=null;
  const classes=new Set(['menu-open']);
  const html={classList:{
    add:(s)=>classes.add(s),
    remove:(...items)=>items.forEach(s=>classes.delete(s))
  }};
  const context={
    document:{documentElement:html,getElementById:(id)=>nodes.get(id)},
    location:{href:'https://example.test/zomboidtury/?mobile=1',reload:()=>{}},
    history:{state:null,replaceState:(_state,_title,url)=>{updatedUrl=url;}},
    localStorage:{getItem:()=>null,setItem:()=>{}},
    URL,
    window:{},
    MutationObserver:class{observe(){}}
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('bo1z-menu.js','utf8'),context);
  assert.equal(downloads,0,'Rendering the menu must not start the download');
  assert.equal(context.window.BO1ZMenu!==undefined,true);
  assert.equal(home.hidden,false);
  assert.equal(loading.hidden,true);
  assert.equal(start.disabled,false);
  const fps=nodes.get('bm-fps');
  fps.value='45';fps.listeners.change();
  const audio=nodes.get('bm-audio');
  audio.value='off';audio.listeners.change();
  start.click();
  assert.equal(downloads,1);
  assert.equal(home.hidden,true);
  assert.equal(loading.hidden,false);
  assert.equal(classes.has('game-loading'),true);
  assert.equal(classes.has('menu-open'),false);
  assert.match(updatedUrl,/fps=45/);
  assert.match(updatedUrl,/nosnd=1/);
  assert.match(updatedUrl,/rmode=960x540/);
  start.click();
  assert.equal(downloads,1,'Second click must not start engine again');
});
