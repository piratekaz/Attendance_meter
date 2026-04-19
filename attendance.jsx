import { useState, useEffect } from "react";

/* ── Persistent storage ─────────────────────────────────────────── */
const db = {
  async get(k)   { try { const r = await window.storage.get(k,false); return r?.value??null; } catch { return null; } },
  async set(k,v) { try { await window.storage.set(k,v,false); } catch {} },
  async del(k)   { try { await window.storage.delete(k,false); } catch {} }
};

/* ── Password hashing (SHA-256 via Web Crypto) ──────────────────── */
async function hashPw(password) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(password));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
}

/* ── Auth helpers ────────────────────────────────────────────────── */
const pwKey  = n => `attn:pw:${n}`;   // stores SHA-256 hex of password
const dataKey = n => `attn:u:${n}`;

async function userExists(name) {
  return (await db.get(dataKey(name))) !== null;
}

async function verifyPassword(name, password) {
  const stored = await db.get(pwKey(name));
  if (!stored) return true;              // legacy user without pw — let through
  return stored === await hashPw(password);
}

async function setPassword(name, password) {
  await db.set(pwKey(name), await hashPw(password));
}

/* ── Attendance math ─────────────────────────────────────────────── */
function calcPct(p, t) { return t === 0 ? 0 : Math.round(p / t * 1000) / 10; }

function calcAdvice(p, t, th) {
  const pc = calcPct(p, t);
  if (th >= 100) {
    if (pc >= 100) return { ok:true,  label:"Perfect attendance" };
    return            { ok:false, label:"Must attend all remaining classes" };
  }
  if (pc >= th) {
    const b = Math.max(0, Math.floor((100*p - th*t) / th));
    return { ok:true,  label: b===0 ? "At threshold — attend next class" : `Can skip ${b} more class${b!==1?"es":""}` };
  }
  const n = Math.max(0, Math.ceil((th*t - 100*p) / (100-th)));
  return { ok:false, label: n===0 ? "Attend every class" : `Need ${n} more consecutive class${n!==1?"es":""}` };
}

function statusColor(pc, th) {
  if (pc >= th)      return C.green;
  if (pc >= th - 10) return C.amber;
  return C.red;
}

/* ── Design tokens ───────────────────────────────────────────────── */
const C = {
  blue:"#2563eb", blueL:"#eff6ff", blueM:"#bfdbfe", navy:"#1e3a5f",
  green:"#16a34a", greenL:"#f0fdf4",
  amber:"#d97706", amberL:"#fffbeb",
  red:"#dc2626",   redL:"#fef2f2",
  text:"#0f172a",  sub:"#475569",  muted:"#94a3b8",
  border:"#e2e8f0", borderM:"#cbd5e1",
  bg:"#f8fafc", card:"#ffffff",
};

const cl  = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,6);

/* ── Export helpers ──────────────────────────────────────────────── */
function dlBlob(content, name, type) {
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([content], { type })), download: name
  });
  a.click(); URL.revokeObjectURL(a.href);
}

/* ════════════════════════════════════════════════════════════════════
   ROOT
   ════════════════════════════════════════════════════════════════════ */
export default function App() {
  const [screen,     setScreen]     = useState("loading"); // loading | login | dash
  const [uname,      setUname]      = useState("");
  const [data,       setData]       = useState(null);
  const [modal,      setModal]      = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [toast,      setToast]      = useState(null);

  /* auto-restore session */
  useEffect(() => {
    (async () => {
      const cu  = await db.get("attn:cu");
      if (cu) {
        const raw = await db.get(dataKey(cu));
        if (raw) { setUname(cu); setData(JSON.parse(raw)); setScreen("dash"); return; }
      }
      setScreen("login");
    })();
  }, []);

  /* persist on change */
  useEffect(() => {
    if (data && uname) db.set(dataKey(uname), JSON.stringify(data));
  }, [data, uname]);

  const showToast = (msg, warn=false) => {
    setToast({msg,warn}); setTimeout(()=>setToast(null), 2500);
  };

  /* ── AUTH ─────────────────────────────────────────────────────── */
  const doLogin = async (name, password) => {
    const ok = await verifyPassword(name, password);
    if (!ok) return "Incorrect password.";
    const raw = await db.get(dataKey(name));
    const d   = raw ? JSON.parse(raw) : { threshold:75, subjects:[], holidays:[] };
    await db.set("attn:cu", name);
    setUname(name); setData(d); setScreen("dash");
    return null; // no error
  };

  const doRegister = async (name, password) => {
    // check not already taken
    if (await userExists(name)) return "Username already exists. Try logging in.";
    await setPassword(name, password);
    await db.set(dataKey(name), JSON.stringify({ threshold:75, subjects:[], holidays:[] }));
    await db.set("attn:cu", name);
    setUname(name); setData({ threshold:75, subjects:[], holidays:[] }); setScreen("dash");
    return null;
  };

  const logout = async () => {
    await db.del("attn:cu");
    setUname(""); setData(null); setScreen("login");
  };

  /* ── SUBJECT OPS ──────────────────────────────────────────────── */
  const addSub = (name, total, present) => {
    if (!name.trim()) return;
    const t = cl(+total||0,0,9999), p = cl(+present||0,0,t);
    setData(d => ({ ...d, subjects:[...d.subjects, {id:uid(),name:name.trim(),total:t,present:p}] }));
    showToast(`"${name.trim()}" added`);
  };

  const updateSub = (id, changes) =>
    setData(d => ({ ...d, subjects:d.subjects.map(s => s.id===id ? {...s,...changes} : s) }));

  const deleteSub = (id, name) => {
    setData(d => ({ ...d, subjects:d.subjects.filter(s=>s.id!==id) }));
    showToast(`"${name}" removed`, true);
  };

  const markPresent = id => setData(d => ({ ...d, subjects:d.subjects.map(s=>s.id===id?{...s,total:s.total+1,present:s.present+1}:s) }));
  const markAbsent  = id => setData(d => ({ ...d, subjects:d.subjects.map(s=>s.id===id?{...s,total:s.total+1}:s) }));

  /* ── HOLIDAY OPS ──────────────────────────────────────────────── */
  const addHoliday = (date, label) => {
    if (!date) return;
    setData(d => ({
      ...d,
      holidays:[...d.holidays,{id:uid(),date,label:label||"Holiday"}].sort((a,b)=>a.date>b.date?1:-1)
    }));
  };
  const delHoliday = id => setData(d => ({ ...d, holidays:d.holidays.filter(h=>h.id!==id) }));

  /* ── DERIVED ──────────────────────────────────────────────────── */
  const subs   = data?.subjects||[], hols = data?.holidays||[], th = data?.threshold||75;
  const totalP = subs.reduce((a,s)=>a+s.present,0), totalT = subs.reduce((a,s)=>a+s.total,0);
  const overallPct = calcPct(totalP,totalT);
  const atRisk = subs.filter(s=>calcPct(s.present,s.total)<th).length;
  const nextHol = hols.find(h=>h.date>=new Date().toISOString().slice(0,10));

  /* ── EXPORT ───────────────────────────────────────────────────── */
  const doCSV = () => {
    const rows = [["Subject","Present","Total","Percentage","Status","Advice"]];
    subs.forEach(s => {
      const pc=calcPct(s.present,s.total), adv=calcAdvice(s.present,s.total,th);
      rows.push([s.name,s.present,s.total,pc+"%",pc>=th?"Safe":"At Risk",adv.label]);
    });
    dlBlob(rows.map(r=>r.map(c=>`"${c}"`).join(",")).join("\n"),"attendance.csv","text/csv");
  };
  const doJSON = () =>
    dlBlob(JSON.stringify({username:uname,...data,exportedAt:new Date().toISOString()},null,2),"attendance.json","application/json");

  /* ── RENDER ───────────────────────────────────────────────────── */
  if (screen==="loading") return <Spinner/>;
  if (screen==="login")   return <LoginScreen onLogin={doLogin} onRegister={doRegister}/>;

  return (
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"'Inter',sans-serif"}}>
      <Fonts/>

      {/* HEADER */}
      <header style={S.header}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={S.logoMark}>A</div>
          <div>
            <div style={{fontWeight:700,fontSize:18,color:C.text}}>Attenda</div>
            <div style={{fontSize:11,color:C.muted}}>Attendance Tracker</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
          <UserBadge name={uname}/>
          <GBtn onClick={()=>setModal("holidays")}>📅 Holidays</GBtn>
          <GBtn onClick={()=>setModal("settings")}>⚙ Settings</GBtn>
          <GBtn onClick={doCSV}>↓ CSV</GBtn>
          <GBtn onClick={doJSON}>↓ JSON</GBtn>
          <GBtn style={{color:C.red,borderColor:"#fca5a5"}} onClick={logout}>Sign out</GBtn>
        </div>
      </header>

      {/* STATS STRIP */}
      {subs.length>0 && (
        <div style={S.statsStrip}>
          <StatPill label="Overall"   value={`${overallPct}%`} color={statusColor(overallPct,th)}/>
          <div style={S.div}/>
          <StatPill label="Subjects"  value={subs.length}      color={C.blue}/>
          <StatPill label="At Risk"   value={atRisk}           color={atRisk>0?C.red:C.green}/>
          <div style={S.div}/>
          <StatPill label="Threshold" value={`${th}%`}         color={C.amber}/>
          <StatPill label="Holidays"  value={hols.length}      color="#7c3aed"/>
          {nextHol && <StatPill label="Next Holiday" value={`${nextHol.date.slice(5)} · ${nextHol.label}`} color="#7c3aed"/>}
        </div>
      )}

      {/* RISK BANNER */}
      {atRisk>0 && (
        <div style={S.riskBanner}>
          <span style={S.riskDot}/>{atRisk} subject{atRisk>1?"s":""} below {th}% — immediate attendance required
        </div>
      )}

      {/* MAIN */}
      <main style={{maxWidth:1200,margin:"0 auto",padding:"28px 20px 60px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <div>
            <h2 style={{fontWeight:700,fontSize:20,color:C.text}}>Your Subjects</h2>
            <p style={{fontSize:13,color:C.muted,marginTop:2}}>
              {subs.length===0?"Add a subject to get started":`${subs.length} subject${subs.length!==1?"s":""} tracked`}
            </p>
          </div>
          <PBtn onClick={()=>setModal("add")}>+ Add Subject</PBtn>
        </div>

        {subs.length===0
          ? <EmptyState onAdd={()=>setModal("add")}/>
          : <div style={S.grid}>
              {subs.map(s=>(
                <SubCard key={s.id} sub={s} th={th}
                  onPresent={()=>markPresent(s.id)} onAbsent={()=>markAbsent(s.id)}
                  onEdit={()=>{setEditTarget(s);setModal("edit");}}
                  onDelete={()=>deleteSub(s.id,s.name)}
                />
              ))}
            </div>
        }
      </main>

      {/* MODALS */}
      {modal==="add" && (
        <ModalShell title="Add Subject" onClose={()=>setModal(null)}>
          <AddForm onAdd={(n,t,p)=>{addSub(n,t,p);setModal(null);}} onCancel={()=>setModal(null)}/>
        </ModalShell>
      )}
      {modal==="edit" && editTarget && (
        <ModalShell title="Edit Subject" onClose={()=>{setModal(null);setEditTarget(null);}}>
          <EditForm sub={editTarget}
            onSave={c=>{updateSub(editTarget.id,c);setModal(null);setEditTarget(null);showToast("Subject updated");}}
            onDelete={()=>{deleteSub(editTarget.id,editTarget.name);setModal(null);setEditTarget(null);}}
            onCancel={()=>{setModal(null);setEditTarget(null);}}
          />
        </ModalShell>
      )}
      {modal==="holidays" && (
        <ModalShell title="Holidays" onClose={()=>setModal(null)}>
          <HolidayMgr holidays={hols} onAdd={addHoliday} onRemove={delHoliday}/>
        </ModalShell>
      )}
      {modal==="settings" && (
        <ModalShell title="Settings" onClose={()=>setModal(null)}>
          <SettingsForm th={th} uname={uname}
            onSave={async(newTh,newUname,newPw,oldPw)=>{
              // password change requested
              if (newPw) {
                const ok = await verifyPassword(uname, oldPw);
                if (!ok) { showToast("Current password is incorrect", true); return; }
                await setPassword(newUname||uname, newPw);
              }
              // username change
              if (newUname && newUname!==uname) {
                await db.set(dataKey(newUname), JSON.stringify({...data,threshold:newTh}));
                await db.del(dataKey(uname));
                if (!newPw) await db.set(pwKey(newUname), await db.get(pwKey(uname))||"");
                await db.del(pwKey(uname));
                await db.set("attn:cu", newUname);
                setUname(newUname);
              }
              setData(d=>({...d,threshold:newTh}));
              setModal(null); showToast("Settings saved");
            }}
            onCancel={()=>setModal(null)}
          />
        </ModalShell>
      )}

      {/* TOAST */}
      {toast && (
        <div style={{position:"fixed",bottom:24,right:24,padding:"11px 20px",
          background:toast.warn?C.redL:C.greenL,
          border:`1px solid ${toast.warn?"#fca5a5":"#86efac"}`,
          borderRadius:8,fontSize:13,color:toast.warn?C.red:C.green,
          boxShadow:"0 4px 16px rgba(0,0,0,0.08)",zIndex:200,fontWeight:500}}>
          {toast.warn?"⚠":"✓"} {toast.msg}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   LOGIN SCREEN  (login + register tabs)
   ════════════════════════════════════════════════════════════════════ */
function LoginScreen({ onLogin, onRegister }) {
  const [tab,       setTab]       = useState("login"); // "login" | "register"
  const [name,      setName]      = useState("");
  const [pw,        setPw]        = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [showPw,    setShowPw]    = useState(false);
  const [error,     setError]     = useState("");
  const [loading,   setLoading]   = useState(false);

  const reset = (t) => { setTab(t); setError(""); setPw(""); setPwConfirm(""); };

  const submit = async () => {
    setError("");
    if (!name.trim())   return setError("Please enter your name.");
    if (!pw)            return setError("Please enter a password.");

    if (tab==="register") {
      if (pw.length < 4)       return setError("Password must be at least 4 characters.");
      if (pw !== pwConfirm)    return setError("Passwords do not match.");
    }

    setLoading(true);
    const err = tab==="login"
      ? await onLogin(name.trim(), pw)
      : await onRegister(name.trim(), pw);
    setLoading(false);
    if (err) setError(err);
  };

  const handleKey = e => e.key==="Enter" && submit();

  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"100vh",background:C.bg}}>
      <Fonts/>
      <div style={{width:"100%",maxWidth:400,padding:"0 24px"}}>
        {/* Logo */}
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{width:68,height:68,borderRadius:18,background:C.blue,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px",boxShadow:"0 8px 24px #2563eb33"}}>
            <span style={{color:"#fff",fontSize:32,fontWeight:700}}>A</span>
          </div>
          <h1 style={{fontSize:26,fontWeight:700,color:C.text,marginBottom:4}}>Attenda</h1>
          <p style={{fontSize:13,color:C.muted}}>College attendance tracker</p>
        </div>

        {/* Card */}
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,boxShadow:"0 4px 24px rgba(0,0,0,0.07)",overflow:"hidden"}}>

          {/* Tabs */}
          <div style={{display:"flex",borderBottom:`1px solid ${C.border}`}}>
            {["login","register"].map(t=>(
              <button key={t}
                style={{flex:1,padding:"13px 0",background:"none",border:"none",cursor:"pointer",
                  fontFamily:"Inter,sans-serif",fontSize:13,fontWeight:600,
                  color: tab===t ? C.blue : C.muted,
                  borderBottom: tab===t ? `2px solid ${C.blue}` : "2px solid transparent",
                  transition:"color .15s",marginBottom:-1}}
                onClick={()=>reset(t)}>
                {t==="login" ? "Sign In" : "Create Account"}
              </button>
            ))}
          </div>

          {/* Form */}
          <div style={{padding:"24px 24px 28px"}}>
            <Field label="Name">
              <Input value={name} onChange={e=>setName(e.target.value)} onKeyDown={handleKey}
                placeholder={tab==="login"?"Your registered name":"Choose a username"} autoFocus/>
            </Field>

            <Field label="Password">
              <div style={{position:"relative"}}>
                <Input type={showPw?"text":"password"} value={pw} onChange={e=>setPw(e.target.value)}
                  onKeyDown={handleKey} placeholder="Enter password"
                  style={{paddingRight:44}}/>
                <button onClick={()=>setShowPw(v=>!v)}
                  style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",
                    background:"none",border:"none",cursor:"pointer",color:C.muted,fontSize:16,padding:4}}>
                  {showPw ? "🙈" : "👁"}
                </button>
              </div>
            </Field>

            {tab==="register" && (
              <Field label="Confirm Password">
                <Input type={showPw?"text":"password"} value={pwConfirm} onChange={e=>setPwConfirm(e.target.value)}
                  onKeyDown={handleKey} placeholder="Re-enter password"/>
              </Field>
            )}

            {error && (
              <div style={{background:C.redL,border:`1px solid #fca5a5`,borderRadius:7,padding:"9px 12px",
                fontSize:12,color:C.red,marginBottom:14,fontWeight:500}}>
                ⚠ {error}
              </div>
            )}

            <button
              style={{width:"100%",padding:"12px 0",background:loading?"#93c5fd":C.blue,
                border:"none",borderRadius:8,color:"#fff",fontFamily:"Inter,sans-serif",
                fontWeight:600,fontSize:14,cursor:loading?"not-allowed":"pointer",
                boxShadow:"0 4px 14px #2563eb22",transition:"background .2s"}}
              onClick={submit} disabled={loading}>
              {loading ? "Please wait…" : tab==="login" ? "Sign In →" : "Create Account →"}
            </button>

            {tab==="login" && (
              <p style={{marginTop:16,fontSize:12,color:C.muted,textAlign:"center"}}>
                No account?{" "}
                <span style={{color:C.blue,cursor:"pointer",fontWeight:600}} onClick={()=>reset("register")}>
                  Create one
                </span>
              </p>
            )}
          </div>
        </div>

        <p style={{marginTop:20,fontSize:11,color:C.muted,textAlign:"center"}}>
          🔒 Passwords hashed with SHA-256 · Stored locally · No server
        </p>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   SUBJECT CARD
   ════════════════════════════════════════════════════════════════════ */
function SubCard({sub,th,onPresent,onAbsent,onEdit,onDelete}) {
  const pc = calcPct(sub.present,sub.total);
  const adv = calcAdvice(sub.present,sub.total,th);
  const col = statusColor(pc,th);
  const bgBadge     = pc>=th ? C.greenL : pc>=th-10 ? C.amberL : C.redL;
  const borderBadge = pc>=th ? "#86efac" : pc>=th-10 ? "#fcd34d" : "#fca5a5";
  const [confirmDel,setConfirmDel] = useState(false);

  return (
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:20,
      boxShadow:"0 1px 4px rgba(0,0,0,0.05)",display:"flex",flexDirection:"column",gap:14}}>

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
        <span style={{fontWeight:600,fontSize:15,color:C.text,flex:1,marginRight:8,wordBreak:"break-word",lineHeight:1.3}}>{sub.name}</span>
        <div style={{display:"flex",gap:2,flexShrink:0}}>
          <IBtn onClick={onEdit}>✏</IBtn>
          {confirmDel
            ? <><IBtn style={{color:C.green}} onClick={onDelete}>✓</IBtn><IBtn onClick={()=>setConfirmDel(false)}>✗</IBtn></>
            : <IBtn style={{color:C.red}} onClick={()=>setConfirmDel(true)}>🗑</IBtn>
          }
        </div>
      </div>

      <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between"}}>
        <div style={{display:"inline-flex",alignItems:"baseline",gap:2,background:bgBadge,padding:"6px 14px",borderRadius:8}}>
          <span style={{fontSize:36,fontWeight:700,color:col,lineHeight:1,fontVariantNumeric:"tabular-nums"}}>{pc.toFixed(1)}</span>
          <span style={{fontSize:16,fontWeight:600,color:col}}>%</span>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:20,fontWeight:700,fontVariantNumeric:"tabular-nums"}}>
            <span style={{color:C.green}}>{sub.present}</span>
            <span style={{color:C.muted,fontSize:15}}> / </span>
            <span style={{color:C.sub}}>{sub.total}</span>
          </div>
          <div style={{fontSize:11,color:C.muted,marginTop:2}}>classes attended</div>
        </div>
      </div>

      {/* progress bar with threshold marker */}
      <div style={{height:6,background:C.border,borderRadius:99,position:"relative",overflow:"visible"}}>
        <div style={{height:"100%",width:`${Math.min(pc,100)}%`,background:col,borderRadius:99,transition:"width .35s ease"}}/>
        <div style={{position:"absolute",top:-5,left:`${cl(th,0,100)}%`,transform:"translateX(-50%)",
          width:2,height:16,background:C.muted,borderRadius:1}} title={`${th}% threshold`}/>
      </div>

      <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",
        background:bgBadge,border:`1px solid ${borderBadge}`,borderRadius:8,fontSize:12,color:col,fontWeight:500}}>
        {adv.ok ? "✅" : "⚠️"} {adv.label}
      </div>

      <div style={{display:"flex",gap:8,marginTop:"auto"}}>
        <button style={S.presentBtn} onClick={onPresent}>✓ Present</button>
        <button style={S.absentBtn}  onClick={onAbsent}>✗ Absent</button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   MODAL SHELL + FORMS
   ════════════════════════════════════════════════════════════════════ */
function ModalShell({title,onClose,children}) {
  return (
    <div style={S.overlay} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={S.modal}>
        <div style={S.modalHdr}>
          <span style={{fontWeight:700,fontSize:16,color:C.text}}>{title}</span>
          <button style={{background:"none",border:"none",cursor:"pointer",color:C.muted,fontSize:18}} onClick={onClose}>✕</button>
        </div>
        <div style={{padding:"20px 24px 28px",overflowY:"auto",maxHeight:"70vh"}}>{children}</div>
      </div>
    </div>
  );
}

function AddForm({onAdd,onCancel}) {
  const [n,setN]=useState(""); const [t,setT]=useState(""); const [p,setP]=useState("");
  const submit=()=>n.trim()&&onAdd(n,t,p);
  return (
    <>
      <Field label="Subject Name *"><Input value={n} onChange={e=>setN(e.target.value)} placeholder="e.g. Data Structures" autoFocus onKeyDown={e=>e.key==="Enter"&&submit()}/></Field>
      <Field label="Total Classes Held (optional)"><Input type="number" min="0" value={t} onChange={e=>setT(e.target.value)} placeholder="0"/></Field>
      <Field label="Classes Already Attended (optional)"><Input type="number" min="0" value={p} onChange={e=>setP(e.target.value)} placeholder="0"/></Field>
      <div style={{display:"flex",gap:10,marginTop:20}}>
        <PBtn style={{flex:1}} onClick={submit}>Add Subject</PBtn>
        <GBtn style={{flex:1}} onClick={onCancel}>Cancel</GBtn>
      </div>
    </>
  );
}

function EditForm({sub,onSave,onDelete,onCancel}) {
  const [n,setN]=useState(sub.name); const [t,setT]=useState(String(sub.total)); const [p,setP]=useState(String(sub.present));
  const [delConfirm,setDelConfirm]=useState(false);
  const save=()=>{ if(!n.trim())return; const total=cl(+t||0,0,9999); onSave({name:n.trim(),total,present:cl(+p||0,0,total)}); };
  return (
    <>
      <Field label="Subject Name *"><Input value={n} onChange={e=>setN(e.target.value)} onKeyDown={e=>e.key==="Enter"&&save()}/></Field>
      <Field label="Total Classes Held"><Input type="number" min="0" value={t} onChange={e=>setT(e.target.value)}/></Field>
      <Field label="Classes Attended">
        <Input type="number" min="0" value={p} onChange={e=>setP(e.target.value)}/>
        {+p>+t && <p style={{fontSize:11,color:C.amber,marginTop:4}}>⚠ Will be clamped to total</p>}
      </Field>
      <div style={{display:"flex",gap:10,marginTop:20}}>
        <PBtn style={{flex:1}} onClick={save}>Save Changes</PBtn>
        <GBtn style={{flex:1}} onClick={onCancel}>Cancel</GBtn>
      </div>
      <div style={{marginTop:16,paddingTop:16,borderTop:`1px solid ${C.border}`}}>
        {delConfirm
          ? <div style={{display:"flex",gap:10}}>
              <button style={{...S.dangerBtn,flex:1}} onClick={onDelete}>Confirm Delete</button>
              <GBtn style={{flex:1}} onClick={()=>setDelConfirm(false)}>Cancel</GBtn>
            </div>
          : <button style={{...S.dangerBtn,width:"100%"}} onClick={()=>setDelConfirm(true)}>Delete Subject</button>
        }
      </div>
    </>
  );
}

function HolidayMgr({holidays,onAdd,onRemove}) {
  const [date,setDate]=useState(""); const [label,setLabel]=useState("");
  const add=()=>{ if(!date)return; onAdd(date,label); setDate(""); setLabel(""); };
  return (
    <>
      <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
        <Input type="date" style={{flex:"0 0 160px"}} value={date} onChange={e=>setDate(e.target.value)}/>
        <Input placeholder="Label (e.g. Diwali)" value={label} onChange={e=>setLabel(e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()} style={{flex:1,minWidth:120}}/>
        <PBtn onClick={add}>Add</PBtn>
      </div>
      {holidays.length===0
        ? <p style={{textAlign:"center",padding:"28px 0",color:C.muted,fontSize:13}}>No holidays recorded yet</p>
        : holidays.map(h=>(
            <div key={h.id} style={{display:"flex",alignItems:"center",padding:"10px 0",borderBottom:`1px solid ${C.border}`}}>
              <span style={{fontSize:12,color:"#7c3aed",minWidth:90,fontVariantNumeric:"tabular-nums"}}>{h.date}</span>
              <span style={{flex:1,fontSize:13,color:C.text,marginLeft:16}}>{h.label}</span>
              <IBtn style={{color:C.red}} onClick={()=>onRemove(h.id)}>✕</IBtn>
            </div>
          ))
      }
    </>
  );
}

function SettingsForm({th,uname,onSave,onCancel}) {
  const [threshold, setThreshold] = useState(String(th));
  const [username,  setUsername]  = useState(uname);
  const [oldPw,     setOldPw]     = useState("");
  const [newPw,     setNewPw]     = useState("");
  const [newPw2,    setNewPw2]    = useState("");
  const [showPw,    setShowPw]    = useState(false);
  const [pwError,   setPwError]   = useState("");
  const [changePw,  setChangePw]  = useState(false);

  const save = () => {
    setPwError("");
    if (changePw) {
      if (!oldPw)          return setPwError("Enter your current password.");
      if (newPw.length < 4) return setPwError("New password must be at least 4 characters.");
      if (newPw !== newPw2)  return setPwError("New passwords do not match.");
    }
    onSave(cl(+threshold||75,1,99), username.trim()||uname, changePw?newPw:"", changePw?oldPw:"");
  };

  return (
    <>
      <Field label="Minimum Attendance Threshold (%)">
        <Input type="number" min="1" max="99" value={threshold} onChange={e=>setThreshold(e.target.value)}/>
        <p style={{fontSize:12,color:C.muted,marginTop:5}}>Subjects below this % are flagged at risk. (1–99%)</p>
      </Field>

      <Field label="Display Name">
        <Input value={username} onChange={e=>setUsername(e.target.value)}/>
        <p style={{fontSize:12,color:C.muted,marginTop:5}}>Renaming migrates all data to the new profile.</p>
      </Field>

      {/* Change password section */}
      <div style={{marginTop:4,paddingTop:16,borderTop:`1px solid ${C.border}`}}>
        <button style={{background:"none",border:"none",cursor:"pointer",color:C.blue,fontSize:13,fontWeight:600,padding:0,fontFamily:"Inter,sans-serif"}}
          onClick={()=>{setChangePw(v=>!v);setPwError("");}}>
          {changePw ? "▲ Cancel password change" : "🔑 Change password"}
        </button>

        {changePw && (
          <div style={{marginTop:14}}>
            <Field label="Current Password">
              <div style={{position:"relative"}}>
                <Input type={showPw?"text":"password"} value={oldPw} onChange={e=>setOldPw(e.target.value)}
                  placeholder="Your current password" style={{paddingRight:40}}/>
                <button onClick={()=>setShowPw(v=>!v)}
                  style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:C.muted,fontSize:15}}>
                  {showPw?"🙈":"👁"}
                </button>
              </div>
            </Field>
            <Field label="New Password">
              <Input type={showPw?"text":"password"} value={newPw} onChange={e=>setNewPw(e.target.value)} placeholder="Min. 4 characters"/>
            </Field>
            <Field label="Confirm New Password">
              <Input type={showPw?"text":"password"} value={newPw2} onChange={e=>setNewPw2(e.target.value)} placeholder="Repeat new password"/>
            </Field>
            {pwError && (
              <div style={{background:C.redL,border:`1px solid #fca5a5`,borderRadius:7,padding:"8px 12px",fontSize:12,color:C.red,marginBottom:10,fontWeight:500}}>
                ⚠ {pwError}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{display:"flex",gap:10,marginTop:20}}>
        <PBtn style={{flex:1}} onClick={save}>Save Settings</PBtn>
        <GBtn style={{flex:1}} onClick={onCancel}>Cancel</GBtn>
      </div>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════════
   SHARED PRIMITIVES
   ════════════════════════════════════════════════════════════════════ */
function Fonts() {
  return <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
    ::-webkit-scrollbar{width:6px;}::-webkit-scrollbar-track{background:#f1f5f9;}
    ::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px;}
    input[type=date]::-webkit-calendar-picker-indicator{cursor:pointer;opacity:0.6;}
    button{transition:opacity .12s;}button:hover{opacity:.85;}
    input[type=password]{letter-spacing:0.1em;}
  `}</style>;
}

function Spinner() {
  return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:C.bg,color:C.blue,fontFamily:"Inter,sans-serif",fontSize:16,fontWeight:600}}>Loading…</div>;
}

function EmptyState({onAdd}) {
  return (
    <div style={{textAlign:"center",padding:"72px 20px",background:C.card,border:`1px dashed ${C.borderM}`,borderRadius:16}}>
      <div style={{fontSize:44,marginBottom:16}}>📚</div>
      <h3 style={{fontWeight:600,fontSize:18,color:C.text,marginBottom:8}}>No subjects yet</h3>
      <p style={{fontSize:14,color:C.muted,marginBottom:24}}>Add your subjects to start tracking attendance</p>
      <PBtn onClick={onAdd}>+ Add Your First Subject</PBtn>
    </div>
  );
}

function StatPill({label,value,color}) {
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
      <span style={{fontSize:20,fontWeight:700,color,fontVariantNumeric:"tabular-nums"}}>{value}</span>
      <span style={{fontSize:11,color:C.muted,fontWeight:500,whiteSpace:"nowrap"}}>{label}</span>
    </div>
  );
}

function UserBadge({name}) {
  const initials = name.slice(0,2).toUpperCase();
  return (
    <div style={{display:"flex",alignItems:"center",gap:8,padding:"5px 12px 5px 5px",background:C.blueL,borderRadius:20,border:`1px solid ${C.blueM}`}}>
      <div style={{width:28,height:28,borderRadius:"50%",background:C.blue,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:12,fontWeight:700}}>{initials}</div>
      <span style={{fontSize:13,color:C.navy,fontWeight:500}}>{name}</span>
    </div>
  );
}

function Field({label,children}) {
  return (
    <div style={{marginBottom:16}}>
      <label style={{display:"block",fontSize:12,fontWeight:600,color:C.sub,marginBottom:6,letterSpacing:0.3}}>{label}</label>
      {children}
    </div>
  );
}

const Input = ({style,...p}) => (
  <input
    style={{background:"#fff",border:`1.5px solid ${C.border}`,borderRadius:8,color:C.text,
      fontFamily:"Inter,sans-serif",fontSize:14,padding:"9px 12px",outline:"none",width:"100%",
      transition:"border-color .15s",...style}}
    onFocus={e=>e.target.style.borderColor=C.blue}
    onBlur={e=>e.target.style.borderColor=C.border}
    {...p}
  />
);

const IBtn = ({style,...p}) => (
  <button style={{background:"none",border:"none",cursor:"pointer",color:C.muted,fontSize:14,padding:"3px 6px",borderRadius:5,...style}} {...p}/>
);

const PBtn = ({style,...p}) => (
  <button style={{background:C.blue,border:"none",borderRadius:8,color:"#fff",fontFamily:"Inter,sans-serif",fontSize:13,fontWeight:600,padding:"9px 18px",cursor:"pointer",boxShadow:"0 2px 8px #2563eb22",...style}} {...p}/>
);

const GBtn = ({style,...p}) => (
  <button style={{background:"#fff",border:`1.5px solid ${C.border}`,borderRadius:7,color:C.sub,fontFamily:"Inter,sans-serif",fontSize:12,fontWeight:500,padding:"6px 12px",cursor:"pointer",...style}} {...p}/>
);

const S = {
  header:{background:"#fff",borderBottom:`1px solid ${C.border}`,padding:"14px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10,boxShadow:"0 1px 3px rgba(0,0,0,0.06)",position:"sticky",top:0,zIndex:50},
  statsStrip:{background:"#fff",borderBottom:`1px solid ${C.border}`,padding:"14px 28px",display:"flex",gap:28,flexWrap:"wrap",alignItems:"center"},
  div:{width:1,height:28,background:C.border,alignSelf:"center"},
  riskBanner:{background:"#fef2f2",borderBottom:"1px solid #fecaca",color:C.red,padding:"10px 28px",fontSize:13,fontWeight:500,display:"flex",alignItems:"center",gap:8},
  riskDot:{width:8,height:8,borderRadius:"50%",background:C.red,flexShrink:0,display:"inline-block"},
  grid:{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(270px,1fr))",gap:16},
  presentBtn:{flex:1,padding:"9px 0",background:C.greenL,border:"1.5px solid #86efac",borderRadius:7,color:C.green,fontFamily:"Inter,sans-serif",fontSize:13,fontWeight:600,cursor:"pointer"},
  absentBtn:{flex:1,padding:"9px 0",background:C.redL,border:"1.5px solid #fca5a5",borderRadius:7,color:C.red,fontFamily:"Inter,sans-serif",fontSize:13,fontWeight:600,cursor:"pointer"},
  overlay:{position:"fixed",inset:0,background:"rgba(15,23,42,0.4)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,padding:20},
  modal:{background:"#fff",borderRadius:14,boxShadow:"0 20px 60px rgba(0,0,0,0.15)",width:"100%",maxWidth:460,maxHeight:"90vh",display:"flex",flexDirection:"column"},
  modalHdr:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"18px 24px 16px",borderBottom:`1px solid ${C.border}`},
  dangerBtn:{padding:"9px 0",background:"#fff",border:`1.5px solid ${C.red}`,borderRadius:7,color:C.red,fontFamily:"Inter,sans-serif",fontSize:13,fontWeight:600,cursor:"pointer"},
  logoMark:{width:38,height:38,borderRadius:10,background:C.blue,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:20,fontWeight:700,flexShrink:0,boxShadow:"0 3px 10px #2563eb33"},
};
