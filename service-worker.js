/* Service worker: офлайн-кэш приложения «Мои кредиты».
   Стратегия: для самой страницы — «сначала сеть» (чтобы обновления
   появлялись сразу), для иконок/шрифтов — «сначала кэш» (быстро). */
const CACHE = 'moi-krediti-v3';
const CORE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './badge-96.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== 'mk-state').map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isPageRequest(req) {
  if (req.mode === 'navigate') return true;
  const url = new URL(req.url);
  return url.origin === location.origin &&
         (url.pathname.endsWith('/') || url.pathname.endsWith('.html'));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // Страница приложения — сначала свежая из сети, кэш только запасной (офлайн)
  if (isPageRequest(req)) {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put('./index.html', copy));
        return res;
      }).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  // Остальное (иконки, шрифты) — сначала кэш, затем сеть
  e.respondWith(
    caches.match(req).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        try {
          const url = new URL(req.url);
          if (url.origin === location.origin ||
              url.host.endsWith('gstatic.com') ||
              url.host.endsWith('googleapis.com')) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
        } catch (_) {}
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});


/* ===== Напоминания о платежах (push с сервера). Текст собирается здесь из
   копии данных, которую приложение кладёт в кэш 'mk-state' после каждого сохранения. ===== */
const MK_T={
  ru:{late:n=>'⏰ Ждёт оплаты: '+n, due:n=>'💳 Сегодня платёж: '+n, soon:(n,d)=>'🔔 '+(d===1?'Завтра':'Через '+d+' дн.')+' платёж: '+n,
      lateW:d=>'срок прошёл '+d+' дн. назад', dueW:'сегодня', soonW:d=>d===1?'завтра':'через '+d+' дн.', ok:'✓ Все платежи отмечены', okB:'Молодец! Ближайших платежей нет.',
      eve:'📝 Запишите выручку за сегодня', eveDone:'✓ День записан', piggy:v=>'Отложите ≈ '+v+' на платежи — и к сроку всё соберётся.', eveB:'Это займёт минуту.', more:n=>'и ещё '+n,
      test:'🔔 Напоминания работают', testB:'Так придёт напоминание о платеже.', open:'Открыть'},
  tg:{late:n=>'⏰ Интизори пардохт: '+n, due:n=>'💳 Имрӯз пардохт: '+n, soon:(n,d)=>'🔔 '+(d===1?'Фардо':'Баъди '+d+' рӯз')+' пардохт: '+n,
      lateW:d=>'мӯҳлат '+d+' рӯз пеш гузашт', dueW:'имрӯз', soonW:d=>d===1?'фардо':'баъди '+d+' рӯз', ok:'✓ Ҳамаи пардохтҳо қайд шудаанд', okB:'Офарин! Пардохтҳои наздик нестанд.',
      eve:'📝 Даромади имрӯзро сабт кунед', eveDone:'✓ Рӯз сабт шуд', piggy:v=>'≈ '+v+' барои пардохтҳо гузоред — то мӯҳлат ҳама ҷамъ мешавад.', eveB:'Як дақиқа вақт мегирад.', more:n=>'ва боз '+n,
      test:'🔔 Ёдраскунӣ кор мекунад', testB:'Ёдраскунии пардохт ҳамин хел меояд.', open:'Кушодан'},
  en:{late:n=>'⏰ Awaiting payment: '+n, due:n=>'💳 Payment due today: '+n, soon:(n,d)=>'🔔 Payment '+(d===1?'tomorrow':'in '+d+' days')+': '+n,
      lateW:d=>'due '+d+' days ago', dueW:'today', soonW:d=>d===1?'tomorrow':'in '+d+' days', ok:'✓ All payments marked', okB:'Well done! No payments coming up.',
      eve:"📝 Log today's revenue", eveDone:'✓ Day logged', piggy:v=>'Put aside ≈ '+v+' for payments and it will be ready on time.', eveB:'It takes a minute.', more:n=>'and '+n+' more',
      test:'🔔 Reminders work', testB:'This is how a payment reminder will look.', open:'Open'}
};
async function mkDigest(){ try{ const c=await caches.open('mk-state'); const r=await c.match('./mk-state.json'); return r?await r.json():{}; }catch(e){ return {}; } }
function mkToday(){ const d=new Date(); return new Date(d.getFullYear(),d.getMonth(),d.getDate()); }
function mkDays(s){ const p=String(s).split('-'); return Math.round((new Date(+p[0],+p[1]-1,+p[2])-mkToday())/86400000); }
function mkMoney(v,cur,lang){ return new Intl.NumberFormat(lang==='en'?'en-US':'ru-RU').format(Math.round(v||0))+' '+(cur||''); }
self.addEventListener('push', e => {
  let d={}; try{ d=e.data?e.data.json():{}; }catch(_){}
  e.waitUntil((async()=>{
    const g=await mkDigest(), lang=MK_T[g.lang]?g.lang:'ru', T=MK_T[lang];
    let title=T.ok, body=T.okB, tag='mk';
    if(d.k==='test'){ title=T.test; body=T.testB; tag='mk-test'; }
    else if(d.k==='eve'){ tag='mk-eve'; const today=(()=>{const x=mkToday();return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');})();
      title=g.logged===today?T.eveDone:T.eve; body=g.perDay>0?T.piggy(mkMoney(g.perDay,g.cur,lang)):T.eveB; }
    else {
      tag='mk-pay';
      const items=(g.items||[]).map(it=>Object.assign({},it,{days:mkDays(it.due)})).filter(it=>it.days<=3).sort((a,b)=>a.days-b.days);
      if(items.length){ const f=items[0];
        title=f.days<0?T.late(f.name):f.days===0?T.due(f.name):T.soon(f.name,f.days);
        body=items.slice(0,3).map(it=>it.name+' · '+mkMoney(it.amt,g.cur,lang)+' · '+(it.days<0?T.lateW(-it.days):it.days===0?T.dueW:T.soonW(it.days))).join('\n')+(items.length>3?'\n'+T.more(items.length-3):''); }
    }
    await self.registration.showNotification(title,{body, icon:'icon-192.png', badge:'badge-96.png', tag, renotify:true, data:{url:'./'}});
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async()=>{
    const all=await clients.matchAll({type:'window',includeUncontrolled:true});
    for(const c of all){ if('focus' in c){ try{ await c.focus(); return; }catch(_){} } }
    if(clients.openWindow) await clients.openWindow('./');
  })());
});
