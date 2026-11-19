(function(){
"use strict";
var $=function(s){return document.querySelector(s)};
var $$=function(s){return Array.prototype.slice.call(document.querySelectorAll(s))};
var esc=function(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})};
var inr=function(n){n=Math.round((n||0)*100)/100;return new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",minimumFractionDigits:Number.isInteger(n)?0:2,maximumFractionDigits:2}).format(n)};
var r2=function(n){return Math.round(n*100)/100};
var pad=function(n){return String(n).padStart(2,"0")};
var todayStr=function(){var d=new Date();return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())};
var dayNum=function(s){var p=s.split("-");return Date.UTC(+p[0],+p[1]-1,+p[2])/86400000};
var addDays=function(s,n){var d=new Date((dayNum(s)+n)*86400000);return d.getUTCFullYear()+"-"+pad(d.getUTCMonth()+1)+"-"+pad(d.getUTCDate())};
var nightsOf=function(a,b){return Math.max(1,Math.round(dayNum(b)-dayNum(a)))};
var fmtDate=function(s){if(!s)return"";var p=s.split("-");return p[2]+"/"+p[1]+"/"+p[0]};
var overlaps=function(blocks,from,to){return (blocks||[]).some(function(x){return x.from<to&&from<x.to})};
var toast=function(msg){var t=$("#toast");t.textContent=msg;t.hidden=false;clearTimeout(toast.h);toast.h=setTimeout(function(){t.hidden=true},2600)};

var db=null,user=null,downloads=null,staff=false,uid=null,canWrite=null,loaded=false;
var S={config:{},rooms:[],bookings:[],charges:[],payments:[],requests:[],myReq:[]};
var ui={tab:"stay",pickRoom:null,sel:null,editRoom:null,rpMonth:todayStr().slice(0,7),setFilled:false};

/* ---------- money & billing ---------- */
function gstCfg(){var c=S.config;return{exempt:c.exempt!=null?c.exempt:1000,mid:c.mid!=null?c.mid:7500,midRate:c.midRate!=null?c.midRate:5,highRate:c.highRate!=null?c.highRate:18}}
function roomGstRate(rate){var g=gstCfg();return rate<=g.exempt?0:(rate<=g.mid?g.midRate:g.highRate)}
function calcBill(b){
  var n=nightsOf(b.checkIn,b.checkOut);
  var base=b.rate*n, disc=Math.min(b.discount||0,base);
  var lines=[{label:"Room "+b.roomNo+" ("+n+" night"+(n>1?"s":"")+" x "+inr(b.rate)+")",taxable:r2(base-disc),rate:roomGstRate(b.rate),kind:"room"}];
  S.charges.filter(function(c){return c.bookingId===b.id}).sort(function(a,c){return (a.createdAt||0)-(c.createdAt||0)}).forEach(function(c){
    lines.push({label:c.label+(c.qty>1?" x "+c.qty:""),taxable:r2(c.qty*c.amount),rate:c.gst,kind:"extra",id:c.id});
  });
  var sub=0,tax=0;
  lines.forEach(function(l){l.tax=r2(l.taxable*l.rate/100);sub+=l.taxable;tax+=l.tax});
  var paid=S.payments.filter(function(p){return p.bookingId===b.id}).reduce(function(a,p){return a+p.amount},0);
  var total=r2(sub+tax);
  return{nights:n,base:base,disc:disc,lines:lines,sub:r2(sub),tax:r2(tax),total:total,paid:r2(paid),due:r2(total-paid)};
}
function invoiceText(b){
  var c=S.config,bl=calcBill(b),L=[];
  L.push((c.name||"Lodge").toUpperCase());
  if(c.address)L.push(c.address);
  if(c.phone)L.push("Phone: "+c.phone);
  if(c.gstin)L.push("GSTIN: "+c.gstin);
  L.push("");
  L.push("TAX INVOICE  "+(b.invoiceNo||"(draft)"));
  L.push("Date: "+fmtDate(b.finalizedAt?b.finalizedAt.slice(0,10):todayStr()));
  L.push("Guest: "+b.guestName+(b.phone?"  ("+b.phone+")":""));
  L.push("Room "+b.roomNo+"   "+fmtDate(b.checkIn)+" to "+fmtDate(b.checkOut));
  L.push("------------------------------------------");
  bl.lines.forEach(function(l){L.push(l.label);L.push("   "+inr(l.taxable)+"  + GST "+l.rate+"% "+inr(l.tax))});
  L.push("------------------------------------------");
  L.push("Taxable value   "+inr(bl.sub));
  var split={};bl.lines.forEach(function(l){if(l.rate>0)split[l.rate]=(split[l.rate]||0)+l.tax});
  Object.keys(split).forEach(function(k){L.push("CGST "+(k/2)+"%        "+inr(split[k]/2));L.push("SGST "+(k/2)+"%        "+inr(split[k]/2))});
  L.push("TOTAL           "+inr(bl.total));
  L.push("Paid            "+inr(bl.paid));
  L.push("Balance         "+inr(bl.due));
  if(c.upi&&bl.due>0)L.push("Pay by UPI: "+c.upi);
  L.push("");L.push("Thank you for staying with us.");
  return L.join("\n");
}

/* ---------- data layer ---------- */
function col(n){return db.collection(n)}
function now(){return Date.now()}
function bookingsOfRoom(id){return S.bookings.filter(function(b){return b.roomId===id})}
async function syncBlocks(roomId){
  var snap=await col("bookings").where("roomId","==",roomId).get();
  var blocks=snap.docs.map(function(d){return d.data()}).filter(function(b){return b.status==="confirmed"||b.status==="checked-in"}).map(function(b){return{from:b.checkIn,to:b.checkOut}});
  await db.doc("rooms/"+roomId).update({blocked:blocks});
}
async function setRoomStatus(id,status){await db.doc("rooms/"+id).update({status:status})}
async function createBooking(d,advance,mode){
  var ref=col("bookings").doc();
  var room=S.rooms.find(function(r){return r.id===d.roomId});
  await ref.set({roomId:d.roomId,roomNo:room.number,guestName:d.name,phone:d.phone||"",idNo:d.idNo||"",guests:d.guests||1,checkIn:d.checkIn,checkOut:d.checkOut,rate:room.rate,status:"confirmed",source:d.source||"desk",note:d.note||"",discount:0,createdAt:now()});
  if(advance>0)await col("payments").add({bookingId:ref.id,mode:mode||"Cash",amount:advance,note:"Advance",createdAt:now(),date:todayStr()});
  await syncBlocks(d.roomId);
  return ref.id;
}

/* ---------- rendering ---------- */
var raf=0;function render(){if(raf)return;raf=requestAnimationFrame(function(){raf=0;draw()})}
function statusPill(s){var m={confirmed:["warn","Confirmed"],"checked-in":["ok","In house"],"checked-out":["","Checked out"],cancelled:["bad","Cancelled"],new:["warn","Awaiting reply"],declined:["bad","Declined"]};var x=m[s]||["",s];return '<span class="pill '+x[0]+'">'+x[1]+"</span>"}
function draw(){
  $("#lodgeName").textContent=S.config.name||"Your Lodge";
  $("#lodgeSub").textContent=[S.config.address,S.config.phone].filter(Boolean).join(" · ");
  drawTabs();
  $$("section.pane").forEach(function(p){p.hidden=p.id!=="pane-"+ui.tab});
  drawStay();
  if(staff){drawDesk();drawBill();drawRooms();drawReports();fillSettings()}
}
function drawTabs(){
  var tabs=staff?[["desk","Front desk"],["bill","Billing"],["rooms","Rooms"],["reports","Reports"],["settings","Settings"],["stay","Guest view"]]:[["stay","Rooms"]];
  var el=$("#tabs");el.hidden=tabs.length<2;
  el.innerHTML=tabs.map(function(t){return '<button type="button" data-tab="'+t[0]+'"'+(ui.tab===t[0]?' aria-current="page"':"")+">"+t[1]+"</button>"}).join("");
}

/* Stay */
function drawStay(){
  var from=$("#f-in").value,to=$("#f-out").value,g=+$("#f-guests").value||1;
  var valid=from&&to&&to>from;
  var rooms=S.rooms.slice().sort(function(a,b){return String(a.number).localeCompare(String(b.number),undefined,{numeric:true})});
  var html=rooms.map(function(r){
    var free=valid?!overlaps(r.blocked,from,to):true;
    var fits=(r.beds||2)>=g;
    var picked=ui.pickRoom===r.id;
    return '<div class="card stack" style="'+(picked?"border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)":"")+'">'
      +'<div class="row between"><h3>Room '+esc(r.number)+'</h3>'+(valid?(free?'<span class="pill ok">Free</span>':'<span class="pill bad">Booked</span>'):"")+'</div>'
      +'<div class="muted small">'+esc(r.type||"Room")+" · "+(r.ac?"AC":"Non-AC")+" · sleeps "+(r.beds||2)+" · floor "+esc(r.floor==null?"":r.floor)+'</div>'
      +'<div class="rate">'+inr(r.rate)+' <span class="muted small" style="font-family:var(--f-body)">per night</span></div>'
      +(fits?"":'<div class="small muted">Too small for '+g+' guests</div>')
      +(!staff?'<button class="btn '+(picked?"primary":"")+'" data-pick="'+r.id+'"'+((!free||!fits)&&valid?" disabled":"")+'>'+(picked?"Selected":"Choose room")+"</button>":"")
      +"</div>";
  }).join("");
  $("#roomGrid").innerHTML=html||'<div class="empty" style="grid-column:1/-1">Rooms will show here once the lodge adds them.</div>';
  $("#reqCard").hidden=staff;
  if(!staff){
    var r=S.rooms.find(function(x){return x.id===ui.pickRoom});
    if(r&&valid){var n=nightsOf(from,to);var gr=roomGstRate(r.rate);var base=r.rate*n;$("#reqSummary").textContent="Room "+r.number+", "+n+" night"+(n>1?"s":"")+", "+fmtDate(from)+" to "+fmtDate(to)+". Room charge "+inr(base)+(gr?" plus "+gr+"% GST":"")+".";}
    else $("#reqSummary").textContent="Pick dates and a room above to begin.";
    var blocked=$("#reqBlocked");
    if(!uid||canWrite===false){blocked.hidden=false;blocked.textContent="Sign in with Google to send a booking request."+(S.config.phone?" Please call "+S.config.phone+" to book.":"");$("#r-send").disabled=true}
    else{blocked.hidden=true;$("#r-send").disabled=false}
    var mine=S.myReq.slice().sort(function(a,b){return b.createdAt-a.createdAt});
    $("#myReqs").innerHTML=mine.length?'<h2>Your requests</h2>'+mine.map(function(q){
      var rm=S.rooms.find(function(x){return x.id===q.roomId});
      return '<div class="card row between"><div style="min-width:0"><b>Room '+esc(rm?rm.number:"")+'</b><div class="muted small">'+fmtDate(q.checkIn)+" to "+fmtDate(q.checkOut)+"</div></div>"+statusPill(q.status)+"</div>";
    }).join(""):"";
  } else $("#myReqs").innerHTML="";
}

/* Desk */
function drawDesk(){
  var t=todayStr();
  var inHouse=S.bookings.filter(function(b){return b.status==="checked-in"});
  var arrivals=S.bookings.filter(function(b){return b.status==="confirmed"&&b.checkIn===t});
  var due=S.bookings.filter(function(b){return b.status==="checked-in"&&b.checkOut<=t});
  var free=S.rooms.filter(function(r){return r.status!=="occupied"&&!overlaps(r.blocked,t,addDays(t,1))}).length;
  var pending=S.requests.filter(function(q){return q.status==="new"});
  $("#deskStats").innerHTML=[["In house",inHouse.length],["Arriving today",arrivals.length],["Leaving today",due.length],["Rooms free tonight",free+" / "+S.rooms.length]].map(function(s){return '<div class="stat"><span class="label">'+s[0]+"</span><b>"+s[1]+"</b></div>"}).join("");
  $("#reqList").innerHTML=pending.length?pending.map(function(q){
    var rm=S.rooms.find(function(x){return x.id===q.roomId});
    var ok=rm&&!overlaps(rm.blocked,q.checkIn,q.checkOut);
    return '<div class="card stack"><div class="row between"><b>'+esc(q.name)+'</b>'+(ok?'<span class="pill ok">Room free</span>':'<span class="pill bad">Clash</span>')+'</div>'
      +'<div class="small muted">Room '+esc(rm?rm.number:"?")+" · "+fmtDate(q.checkIn)+" to "+fmtDate(q.checkOut)+" · "+esc(q.phone)+(q.note?" · "+esc(q.note):"")+"</div>"
      +'<div class="row"><button class="btn primary sm" data-act="req-ok" data-uid="'+esc(q.uid)+'" data-id="'+esc(q.id)+'"'+(ok?"":" disabled")+'>Confirm</button><button class="btn sm danger" data-act="req-no" data-uid="'+esc(q.uid)+'" data-id="'+esc(q.id)+'">Decline</button></div></div>';
  }).join(""):'<div class="empty">No new requests.</div>';
  var list=S.bookings.filter(function(b){return b.status==="confirmed"||b.status==="checked-in"}).sort(function(a,b){return a.checkIn.localeCompare(b.checkIn)});
  $("#bookList").innerHTML=list.length?list.map(function(b){
    var bl=calcBill(b);
    return '<div class="card stack"><div class="row between"><div style="min-width:0"><b>'+esc(b.guestName)+'</b> <span class="muted">· Room '+esc(b.roomNo)+'</span></div>'+statusPill(b.status)+"</div>"
      +'<div class="small muted">'+fmtDate(b.checkIn)+" to "+fmtDate(b.checkOut)+" · "+esc(b.phone)+" · due "+inr(bl.due)+"</div>"
      +'<div class="row">'+(b.status==="confirmed"?'<button class="btn primary sm" data-act="checkin" data-id="'+b.id+'">Check in</button>':"")
      +'<button class="btn sm" data-act="openbill" data-id="'+b.id+'">Bill</button>'
      +(b.status==="confirmed"?'<button class="btn sm danger" data-act="cancel" data-id="'+b.id+'">Cancel</button>':"")+"</div></div>";
  }).join(""):'<div class="empty">No active bookings. Add a walk-in with the form.</div>';
  var sel=$("#nb-room"),from=$("#nb-in").value,to=$("#nb-out").value,keep=sel.value;
  var opts=S.rooms.slice().sort(function(a,b){return String(a.number).localeCompare(String(b.number),undefined,{numeric:true})}).filter(function(r){return from&&to&&to>from?!overlaps(r.blocked,from,to):true});
  sel.innerHTML=opts.map(function(r){return '<option value="'+r.id+'">Room '+esc(r.number)+" · "+esc(r.type||"")+" · "+inr(r.rate)+"</option>"}).join("")||'<option value="">No room free for these dates</option>';
  if(keep&&opts.some(function(r){return r.id===keep}))sel.value=keep;
  var rr=S.rooms.find(function(x){return x.id===sel.value});
  $("#nb-est").textContent=rr&&from&&to&&to>from?nightsOf(from,to)+" night(s), room charge "+inr(rr.rate*nightsOf(from,to)):"";
}

/* Bill */
function drawBill(){
  var list=S.bookings.filter(function(b){return b.status!=="cancelled"}).sort(function(a,b){var o={"checked-in":0,confirmed:1,"checked-out":2};return (o[a.status]-o[b.status])||(b.createdAt-a.createdAt)});
  var sel=$("#bill-pick");
  sel.innerHTML='<option value="">Select a booking</option>'+list.map(function(b){return '<option value="'+b.id+'">'+esc(b.guestName)+" · Room "+esc(b.roomNo)+" · "+fmtDate(b.checkIn)+" ("+b.status+")</option>"}).join("");
  if(ui.sel&&!list.some(function(b){return b.id===ui.sel}))ui.sel=null;
  sel.value=ui.sel||"";
  var b=list.find(function(x){return x.id===ui.sel});
  $("#billEmpty").hidden=!!b;$("#billBody").hidden=!b;
  if(!b)return;
  var bl=calcBill(b),fin=b.status==="checked-out";
  $("#billHead").innerHTML='<div class="row between"><h2>'+esc(b.guestName)+"</h2>"+statusPill(b.status)+"</div>"
    +'<div class="muted small">Room '+esc(b.roomNo)+" · "+fmtDate(b.checkIn)+" to "+fmtDate(b.checkOut)+" · "+bl.nights+" night"+(bl.nights>1?"s":"")+(b.phone?" · "+esc(b.phone):"")+(b.idNo?" · ID "+esc(b.idNo):"")+"</div>"
    +(b.invoiceNo?'<div class="mono small">Invoice '+esc(b.invoiceNo)+"</div>":"");
  var rows=bl.lines.map(function(l){return "<tr><td>"+esc(l.label)+'</td><td class="r num">'+inr(l.taxable)+'</td><td class="r num">'+l.rate+'%</td><td class="r">'+(l.kind==="extra"&&!fin?'<button class="btn sm danger" data-act="del-charge" data-id="'+l.id+'">Remove</button>':"")+"</td></tr>"}).join("");
  $("#chargeTable").innerHTML='<tr><th>Item</th><th class="r">Amount</th><th class="r">GST</th><th></th></tr>'+rows;
  var pays=S.payments.filter(function(p){return p.bookingId===b.id}).sort(function(a,c){return a.createdAt-c.createdAt});
  $("#payTable").innerHTML=pays.length?'<tr><th>Mode</th><th class="r">Amount</th><th></th></tr>'+pays.map(function(p){return "<tr><td>"+esc(p.mode)+(p.note?' <span class="muted small">'+esc(p.note)+"</span>":"")+'</td><td class="r num">'+inr(p.amount)+'</td><td class="r"><button class="btn sm danger" data-act="del-pay" data-id="'+p.id+'">Remove</button></td></tr>'}).join(""):'<tr><td class="muted">No payments yet.</td></tr>';
  $("#totals").innerHTML="<span>Taxable value</span><span class='num'>"+inr(bl.sub)+"</span><span>GST</span><span class='num'>"+inr(bl.tax)+"</span><span class='g'>Total</span><span class='g num'>"+inr(bl.total)+"</span><span>Paid</span><span class='num'>"+inr(bl.paid)+"</span><span><b>Balance due</b></span><span class='num'><b>"+inr(bl.due)+"</b></span>";
  var disc=$("#b-disc");if(document.activeElement!==disc)disc.value=b.discount||"";disc.disabled=fin;
  $("#chargeForm").hidden=fin;
  var fb=$("#b-final");fb.hidden=fin;fb.disabled=b.status==="confirmed";fb.title=b.status==="confirmed"?"Check the guest in first":"";
  $("#invCard").hidden=!fin;
  if(fin)$("#invText").textContent=invoiceText(b);
}

/* Rooms admin */
function drawRooms(){
  var rooms=S.rooms.slice().sort(function(a,b){return String(a.number).localeCompare(String(b.number),undefined,{numeric:true})});
  $("#roomAdmin").innerHTML=rooms.length?rooms.map(function(r){
    var st=r.status||"available";
    return '<div class="card stack"><div class="row between"><b>Room '+esc(r.number)+' <span class="muted">· '+esc(r.type||"")+'</span></b><span class="pill '+(st==="available"?"ok":st==="occupied"?"warn":"")+'">'+esc(st)+"</span></div>"
      +'<div class="small muted">'+inr(r.rate)+" per night · "+(r.ac?"AC":"Non-AC")+" · sleeps "+(r.beds||2)+" · floor "+esc(r.floor==null?"":r.floor)+"</div>"
      +'<div class="row"><button class="btn sm" data-act="room-edit" data-id="'+r.id+'">Edit</button>'
      +(st==="cleaning"?'<button class="btn sm primary" data-act="room-clean" data-id="'+r.id+'">Mark clean</button>':"")
      +'<button class="btn sm danger" data-act="room-del" data-id="'+r.id+'">Delete</button></div></div>';
  }).join(""):'<div class="empty">Add your first room with the form.</div>';
}

/* Reports */
function drawReports(){
  var m=ui.rpMonth,mi=$("#rp-month");if(document.activeElement!==mi)mi.value=m;
  var first=m+"-01",y=+m.slice(0,4),mo=+m.slice(5,7),days=new Date(y,mo,0).getDate(),end=addDays(first,days);
  var inv=S.bookings.filter(function(b){return b.status==="checked-out"&&b.finalizedAt&&b.finalizedAt.slice(0,7)===m});
  var revenue=0,tax=0;inv.forEach(function(b){var c=calcBill(b);revenue+=c.total;tax+=c.tax});
  var pays=S.payments.filter(function(p){return (p.date||"").slice(0,7)===m});
  var coll=pays.reduce(function(a,p){return a+p.amount},0);
  var occ=0;S.bookings.filter(function(b){return b.status==="checked-in"||b.status==="checked-out"}).forEach(function(b){var a=b.checkIn>first?b.checkIn:first,z=b.checkOut<end?b.checkOut:end;if(z>a)occ+=dayNum(z)-dayNum(a)});
  var cap=S.rooms.length*days,pct=cap?Math.round(occ/cap*100):0;
  $("#rpStats").innerHTML=[["Invoiced",inr(revenue)],["GST in invoices",inr(tax)],["Collected",inr(coll)],["Occupancy",pct+"%"]].map(function(s){return '<div class="stat"><span class="label">'+s[0]+"</span><b>"+s[1]+"</b></div>"}).join("");
  var byMode={};pays.forEach(function(p){byMode[p.mode]=(byMode[p.mode]||0)+p.amount});
  var keys=Object.keys(byMode);
  $("#rpModes").innerHTML=keys.length?keys.map(function(k){var w=coll?Math.round(byMode[k]/coll*100):0;return '<div><div class="row between small"><span>'+esc(k)+'</span><span class="num">'+inr(byMode[k])+'</span></div><div class="bar"><i style="width:'+w+'%"></i></div></div>'}).join(""):'<div class="empty">No payments this month.</div>';
  var dues=S.bookings.filter(function(b){return b.status==="checked-in"||b.status==="checked-out"}).map(function(b){return{b:b,d:calcBill(b).due}}).filter(function(x){return x.d>0.009});
  $("#rpDue").innerHTML=dues.length?dues.map(function(x){return '<div class="row between"><span>'+esc(x.b.guestName)+' <span class="muted small">Room '+esc(x.b.roomNo)+'</span></span><span class="num">'+inr(x.d)+"</span></div>"}).join(""):'<div class="empty">Nothing outstanding.</div>';
}

/* Settings */
function fillSettings(){
  if(ui.setFilled||!loaded)return;ui.setFilled=true;var c=S.config,g=gstCfg();
  $("#s-name").value=c.name||"";$("#s-addr").value=c.address||"";$("#s-phone").value=c.phone||"";$("#s-gstin").value=c.gstin||"";$("#s-upi").value=c.upi||"";$("#s-prefix").value=c.prefix||"INV-";
  $("#s-exempt").value=g.exempt;$("#s-mid").value=g.mid;$("#s-midrate").value=g.midRate;$("#s-highrate").value=g.highRate;
}

/* ---------- actions ---------- */
async function guarded(fn){try{await fn()}catch(e){toast((e&&e.message)?("Could not save: "+e.message):"Could not save. Try again.")}}
function num(id){return parseFloat($(id).value)||0}

async function sendRequest(){
  var r=S.rooms.find(function(x){return x.id===ui.pickRoom}),from=$("#f-in").value,to=$("#f-out").value;
  var name=$("#r-name").value.trim(),phone=$("#r-phone").value.trim();
  if(!r||!from||!to||to<=from){toast("Choose dates and a room first.");return}
  if(!name||!phone){toast("Add your name and phone.");return}
  await guarded(async function(){
    var ref=db.doc("requests/"+uid),snap=await ref.get(),items=snap.exists?(snap.data().items||[]):[];
    items.push({id:"q"+now().toString(36),roomId:r.id,name:name,phone:phone,note:$("#r-note").value.trim(),checkIn:from,checkOut:to,guests:+$("#f-guests").value||1,status:"new",createdAt:now()});
    await ref.set({items:items});
    $("#r-note").value="";ui.pickRoom=null;toast("Request sent. The lodge will confirm with you.");
  });
}
async function setRequestStatus(u,id,status,bookingId){
  var ref=db.doc("requests/"+u),snap=await ref.get(),items=(snap.data()||{}).items||[];
  items=items.map(function(q){return q.id===id?Object.assign({},q,{status:status,bookingId:bookingId||q.bookingId||null}):q});
  await ref.set({items:items});
}
async function onAct(act,id,el){
  await guarded(async function(){
    if(act==="req-ok"){
      var q=S.requests.find(function(x){return x.id===id&&x.uid===el.dataset.uid});if(!q)return;
      var bid=await createBooking({roomId:q.roomId,name:q.name,phone:q.phone,checkIn:q.checkIn,checkOut:q.checkOut,guests:q.guests,note:q.note,source:"guest"},0);
      await setRequestStatus(q.uid,q.id,"confirmed",bid);toast("Booking confirmed.");
    }else if(act==="req-no"){await setRequestStatus(el.dataset.uid,id,"declined");toast("Request declined.")}
    else if(act==="checkin"){var b=S.bookings.find(function(x){return x.id===id});await db.doc("bookings/"+id).update({status:"checked-in",checkedInAt:new Date().toISOString()});await setRoomStatus(b.roomId,"occupied");toast("Checked in.")}
    else if(act==="cancel"){var b2=S.bookings.find(function(x){return x.id===id});await db.doc("bookings/"+id).update({status:"cancelled"});await syncBlocks(b2.roomId);toast("Booking cancelled.")}
    else if(act==="openbill"){ui.sel=id;go("bill")}
    else if(act==="del-charge"){await db.doc("charges/"+id).delete()}
    else if(act==="del-pay"){await db.doc("payments/"+id).delete()}
    else if(act==="room-edit"){var r=S.rooms.find(function(x){return x.id===id});ui.editRoom=id;$("#rf-title").textContent="Edit room "+r.number;$("#rf-no").value=r.number;$("#rf-type").value=r.type||"";$("#rf-rate").value=r.rate;$("#rf-beds").value=r.beds||2;$("#rf-floor").value=r.floor==null?"":r.floor;$("#rf-ac").value=r.ac?"1":"0"}
    else if(act==="room-clean"){await setRoomStatus(id,"available")}
    else if(act==="room-del"){var live=S.bookings.some(function(x){return x.roomId===id&&(x.status==="confirmed"||x.status==="checked-in")});if(live){toast("This room has active bookings.");return}await db.doc("rooms/"+id).delete();toast("Room deleted.")}
  });
}
function clearRoomForm(){ui.editRoom=null;$("#rf-title").textContent="Add a room";["#rf-no","#rf-type","#rf-rate"].forEach(function(s){$(s).value=""});$("#rf-beds").value=2;$("#rf-floor").value=1;$("#rf-ac").value="0"}
function go(t){if(location.hash!=="#"+t)location.hash=t;else{ui.tab=t;render()}}

async function finalize(){
  var b=S.bookings.find(function(x){return x.id===ui.sel});if(!b)return;
  await guarded(async function(){
    var seq=S.bookings.reduce(function(m,x){return Math.max(m,x.invoiceSeq||0)},0)+1,y=new Date().getFullYear();
    var no=(S.config.prefix||"INV-")+y+"-"+String(seq).padStart(4,"0");
    await db.doc("bookings/"+b.id).update({status:"checked-out",invoiceNo:no,invoiceSeq:seq,finalizedAt:new Date().toISOString()});
    await setRoomStatus(b.roomId,"cleaning");await syncBlocks(b.roomId);toast("Invoice "+no+" issued.");
  });
}

/* ---------- wiring ---------- */
function bind(){
  $("#tabs").addEventListener("click",function(e){var b=e.target.closest("[data-tab]");if(b)go(b.dataset.tab)});
  document.addEventListener("click",function(e){
    var p=e.target.closest("[data-pick]");if(p){ui.pickRoom=p.dataset.pick;render();return}
    var a=e.target.closest("[data-act]");if(a)onAct(a.dataset.act,a.dataset.id,a);
  });
  ["#f-in","#f-out","#f-guests"].forEach(function(s){$(s).addEventListener("input",render)});
  ["#nb-in","#nb-out","#nb-room"].forEach(function(s){$(s).addEventListener("input",render)});
  $("#r-send").addEventListener("click",sendRequest);
  $("#nb-save").addEventListener("click",function(){
    var d={roomId:$("#nb-room").value,name:$("#nb-name").value.trim(),phone:$("#nb-phone").value.trim(),idNo:$("#nb-id").value.trim(),guests:+$("#nb-guests").value||1,checkIn:$("#nb-in").value,checkOut:$("#nb-out").value};
    if(!d.roomId||!d.name||!d.checkIn||!d.checkOut||d.checkOut<=d.checkIn){toast("Add dates, a free room and the guest name.");return}
    guarded(async function(){var id=await createBooking(d,num("#nb-adv"),$("#nb-mode").value);["#nb-name","#nb-phone","#nb-id"].forEach(function(s){$(s).value=""});$("#nb-adv").value=0;toast("Booking saved.");ui.sel=id});
  });
  $("#bill-pick").addEventListener("change",function(e){ui.sel=e.target.value||null;render()});
  $("#c-add").addEventListener("click",function(){
    var amt=num("#c-amt"),qty=Math.max(1,parseInt($("#c-qty").value,10)||1);if(!ui.sel||amt<=0){toast("Enter the price of the item.");return}
    guarded(async function(){await col("charges").add({bookingId:ui.sel,label:$("#c-item").value,qty:qty,amount:amt,gst:+$("#c-gst").value,createdAt:now()});$("#c-amt").value="";$("#c-qty").value=1});
  });
  $("#p-add").addEventListener("click",function(){
    var amt=num("#p-amt");if(!ui.sel||amt<=0){toast("Enter the amount received.");return}
    guarded(async function(){await col("payments").add({bookingId:ui.sel,mode:$("#p-mode").value,amount:amt,note:"",createdAt:now(),date:todayStr()});$("#p-amt").value=""});
  });
  $("#b-disc").addEventListener("change",function(){if(ui.sel)guarded(async function(){await db.doc("bookings/"+ui.sel).update({discount:Math.max(0,num("#b-disc"))})})});
  $("#b-final").addEventListener("click",finalize);
  $("#inv-copy").addEventListener("click",function(){
    var t=$("#invText").textContent;
    (navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(function(){toast("Invoice copied.")},function(){var r=document.createRange();r.selectNodeContents($("#invText"));var s=getSelection();s.removeAllRanges();s.addRange(r);toast("Press copy on the selected text.")});
  });
  $("#inv-save").addEventListener("click",function(){
    var b=S.bookings.find(function(x){return x.id===ui.sel});if(!b||!downloads){toast("Saving files is not available here. Use Copy text.");return}
    var html='<!doctype html><meta charset="utf-8"><title>'+esc(b.invoiceNo)+'</title><body style="font:14px/1.6 ui-monospace,monospace;max-width:560px;margin:24px auto;padding:0 16px"><pre style="white-space:pre-wrap">'+esc(invoiceText(b))+"</pre>";
    downloads.save({filename:(b.invoiceNo||"invoice")+".html",data:html}).then(function(){toast("Invoice saved.")},function(e){if(!e||e.code!=="declined")toast("Could not save the file.")});
  });
  $("#rf-save").addEventListener("click",function(){
    var no=$("#rf-no").value.trim(),rate=num("#rf-rate");if(!no||rate<=0){toast("Add a room number and a rate.");return}
    var data={number:no,type:$("#rf-type").value.trim(),rate:rate,beds:parseInt($("#rf-beds").value,10)||2,floor:$("#rf-floor").value===""?null:+$("#rf-floor").value,ac:$("#rf-ac").value==="1"};
    guarded(async function(){
      if(ui.editRoom){await db.doc("rooms/"+ui.editRoom).update(data)}
      else{var ref=col("rooms").doc();await ref.set(Object.assign({status:"available",blocked:[]},data))}
      clearRoomForm();toast("Room saved.");
    });
  });
  $("#rf-clear").addEventListener("click",clearRoomForm);
  $("#rp-month").addEventListener("change",function(e){if(e.target.value){ui.rpMonth=e.target.value;render()}});
  $("#s-save").addEventListener("click",function(){
    guarded(async function(){
      await db.doc("config/lodge").set({name:$("#s-name").value.trim(),address:$("#s-addr").value.trim(),phone:$("#s-phone").value.trim(),gstin:$("#s-gstin").value.trim().toUpperCase(),upi:$("#s-upi").value.trim(),prefix:$("#s-prefix").value.trim()||"INV-",exempt:num("#s-exempt"),mid:num("#s-mid"),midRate:num("#s-midrate"),highRate:num("#s-highrate")});
      toast("Details saved.");
    });
  });
  window.addEventListener("hashchange",function(){applyHash();render()});
}
function applyHash(){
  var h=location.hash.replace("#",""),ok=staff?["desk","bill","rooms","reports","settings","stay"]:["stay"];
  ui.tab=ok.indexOf(h)>=0?h:(staff?"desk":"stay");
}

async function init(){
  var t=todayStr();
  $("#f-in").value=t;$("#f-out").value=addDays(t,1);$("#nb-in").value=t;$("#nb-out").value=addDays(t,1);
  bind();
  var cl=window.lodgeBackend&&window.lodgeBackend.use?window.lodgeBackend:null;
  if(cl){
    try{user=await cl.use("user");db=await cl.use("db");downloads=await cl.use("downloads")}catch(e){}
  }
  var note=$("#statusNote");
  if(!db){note.hidden=false;note.textContent="Lodge Desk is not connected to a database yet. Add your Firebase settings in js/config.js.";applyHash();draw();return}
  staff=user?await user.canEdit():false;
  uid=user?await user.id():null;
  canWrite=user?await user.can("data.write"):null;
  applyHash();
  var timer=setTimeout(function(){if(!loaded){note.hidden=false;note.textContent="Still reaching saved data. Figures may be out of date."}},10000);
  var first=function(){if(!loaded){loaded=true;clearTimeout(timer);note.hidden=true}};
  var fail=function(){note.hidden=false;note.textContent="Lost access to saved data. Reload the page."};
  function sub(name,key){db.collection(name).onSnapshot(function(s){S[key]=s.docs.map(function(d){return Object.assign({id:d.id},d.data())});first();render()},fail)}
  db.doc("config/lodge").onSnapshot(function(s){S.config=s.exists?s.data():{};first();render()},fail);
  sub("rooms","rooms");
  if(staff){
    sub("bookings","bookings");sub("charges","charges");sub("payments","payments");
    db.collection("requests").onSnapshot(function(s){
      var all=[];s.docs.forEach(function(d){((d.data()||{}).items||[]).forEach(function(q){all.push(Object.assign({uid:d.id},q))})});
      S.requests=all;render();
    },fail);
  }else if(uid){
    db.doc("requests/"+uid).onSnapshot(function(s){S.myReq=s.exists?(s.data().items||[]):[];render()},fail);
  }
  render();
}
init();
})();
