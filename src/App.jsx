import { useState, useEffect, useRef, useCallback } from "react"
import {
  LayoutDashboard, Layers, FolderOpen, CalendarDays, AlignLeft, Settings,
  Plus, X, ExternalLink, Check, Link2, FileText, Folder, FolderTree,
  Music, Cpu, Sparkles, BookOpen, Tag, File, Image, Code2, Box,
  Smartphone, Monitor, Tv2, Cloud, HardDrive, ChevronRight,
  AlertTriangle, RefreshCw, Megaphone, Clock, Pencil, Edit3,
  // Type icons
  Shirt, DollarSign, Film, Camera, Pen, Palette, Dumbbell, Heart, Compass,
  Users, Briefcase, Paintbrush, Mic, Video, Scale, Scissors, Building2,
  Trophy, Globe, GraduationCap, Wrench, TrendingUp, Sun, Target,
  Rocket, Lightbulb, Flame, Star, Award, Zap, Shield, Coffee, Feather,
  Mountain, Gift, Hammer, Headphones, Laptop, Medal, Radio, Ruler, Wallet,
  Leaf, Anchor, FlaskConical, Crown, Key, Package, Newspaper, Flag, Map,
  Bookmark, BookMarked, Filter, SlidersHorizontal, Search,
  // Projects-upgrade icons
  Bug, List, LayoutGrid, BarChart3, GripVertical,
  CloudRain, CloudSnow, CloudLightning, CloudDrizzle, CloudFog, MapPin, RotateCw,
  Download
} from "lucide-react"

// ─── Shared backend ───────────────────────────────────────────────────────────
// The one thing that's meant to be "hardcoded," deliberately: this is
// infrastructure (which server the app talks to), not a personal credential.
// Fill this in ONCE after deploying worker.js, then every end user just opens
// the site and signs in — no URL, no setup, no homework. An override still
// exists (Settings → Advanced) for anyone who wants to point at their own
// orchestrator deployment instead, but it's hidden by default.
const DEFAULT_API_BASE = "" // e.g. "https://lifeos-api.you.workers.dev" — set once, ship it

// Feature flags — the Uploader stays built but hidden until platform API
// approvals land. Flip to true to ship it; nothing else needs to change.
const UPLOADER_ENABLED = false

// ─── Dynamic icon renderer — resolves a string name to a Lucide component ─────
const LUCIDE_MAP = {
  LayoutDashboard, Layers, FolderOpen, CalendarDays, AlignLeft, Settings,
  Plus, X, ExternalLink, Check, Link2, FileText, Folder, FolderTree,
  Music, Cpu, Sparkles, BookOpen, Tag, File, Image, Code2, Box,
  Smartphone, Monitor, Tv2, Cloud, HardDrive, Megaphone, Clock, Pencil, Edit3,
  Shirt, DollarSign, Film, Camera, Pen, Palette, Dumbbell, Heart, Compass,
  Users, Briefcase, Paintbrush, Mic, Video, Scale, Scissors, Building2,
  Trophy, Globe, GraduationCap, Wrench, TrendingUp, Sun, Target,
  Rocket, Lightbulb, Flame, Star, Award, Zap, Shield, Coffee, Feather,
  Mountain, Gift, Hammer, Headphones, Laptop, Medal, Radio, Ruler, Wallet,
  Leaf, Anchor, FlaskConical, Crown, Key, Package, Newspaper, Flag, Map,
  Bookmark, BookMarked, Filter, SlidersHorizontal, Search
}
function LucideIcon({ name, size=14, color="currentColor", style={} }){
  const C = LUCIDE_MAP[name] || File
  return <C size={size} color={color} strokeWidth={1.5} style={style}/>
}

// Returns the Lucide icon name for a given category key
function catIconName(catKey, categories){
  const conf = categories?.[catKey]
  if(conf?.icon) return conf.icon
  return TYPE_ICON_MAP[catKey] || "File"
}

// ─── Font injection ───────────────────────────────────────────────────────────
if (!document.getElementById("lifeos-fonts")) {
  const l = document.createElement("link")
  l.id = "lifeos-fonts"
  l.rel = "stylesheet"
  l.href = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600&family=JetBrains+Mono:wght@300;400&display=swap"
  document.head.appendChild(l)
}

// ─── Constants ────────────────────────────────────────────────────────────────
const GEMINI = "gemini-2.5-flash"
const LS_KEY = "lifeos_v2"

// Every project type comes with a starting set of sections — a template,
// not a restriction: any project can add or remove any section regardless
// of its type. Names match categories that already exist rather than
// inventing new taxonomy.
const DEFAULT_CATS = {
  brand:       { color: "#D4A843", emoji: "🏷", sections:["tasks","budget","files"],     hint:"business template" },
  engineering: { color: "#4B9E82", emoji: "⚙️", sections:["tasks","budget","files","resources"], hint:"engineering template" },
  creative:    { color: "#9B6BD4", emoji: "✨", sections:["tasks","files","budget"],      hint:"passion project type" },
  music:       { color: "#6B7FD4", emoji: "🎵", sections:["tasks","files","links"],      hint:"creative template" },
  academic:    { color: "#6A8FBF", emoji: "📚", sections:["tasks","notes"],              hint:"course template" },
  other:       { color: "#666",    emoji: "📁", sections:["tasks"],                       hint:"" },
}

// Every addable section a project can have. "notes" is a plain freeform
// text area for now, not a full block editor — that's tied to the larger
// Notion-as-database architecture work and deliberately not bundled in here.
const SECTION_DEFS = {
  tasks:     { label:"Tasks",              Icon:List },
  budget:    { label:"Budget & Expenses",  Icon:Wallet },
  files:     { label:"Files",              Icon:FolderOpen },
  links:     { label:"Links",              Icon:Link2 },
  resources: { label:"People & Resources", Icon:Users },
  notes:     { label:"Notes",              Icon:AlignLeft },
  tables:    { label:"Tables",             Icon:LayoutGrid },
  charts:    { label:"Charts",             Icon:BarChart3 },
}
const LINK_SUGGESTIONS = ["CAD file (Onshape/Fusion)","GitHub repo","Figma board","Google Doc","Tutorial / reference","Shared drive folder","Spotify / SoundCloud track","Product listing"]

// ─── Colour system for custom event/project types ────────────────────────────
// Notion's Select/Status property colour is a closed, verified enum of
// exactly these 10 names — not a suggestion, the API rejects anything else.
// Event-type colours are constrained to this exact set so a type created in
// LifeOS looks identical on the real Notion Calendar, and vice versa.
// (Dark-mode icon hex values — Notion's most saturated variant, reads best
// against this app's dark background.)
const NOTION_COLORS = [
  { name:"default", hex:"#D3D3D3" }, { name:"gray",   hex:"#7F7F7F" },
  { name:"brown",   hex:"#AA755F" }, { name:"orange", hex:"#D9730D" },
  { name:"yellow",  hex:"#CA8E1B" }, { name:"green",  hex:"#2D9964" },
  { name:"blue",    hex:"#2E7CD1" }, { name:"purple", hex:"#8D5BC1" },
  { name:"pink",    hex:"#C94079" }, { name:"red",    hex:"#CD4945" },
]
const NOTION_COLOR_HEX = Object.fromEntries(NOTION_COLORS.map(c=>[c.name,c.hex]))
// Project types aren't mirrored to a Notion calendar, so they get a handful
// of extra hues beyond Notion's set — still a curated palette, not a free
// colour wheel.
const PROJECT_EXTRA_COLORS = [
  { name:"amber",  hex:"#D4A843" }, { name:"teal",  hex:"#4B9E82" },
  { name:"indigo", hex:"#6B7FD4" }, { name:"steel", hex:"#6A8FBF" },
  { name:"slate",  hex:"#5C6B73" }, { name:"lime",  hex:"#8FA84A" },
]
const PROJECT_COLORS = [...NOTION_COLORS, ...PROJECT_EXTRA_COLORS]

// Seed event types before Notion's real schema loads (or if it's not
// connected yet) — same shape as what fetchNotionEventTypes() returns, so
// nothing downstream needs to special-case "haven't loaded from Notion yet."
const DEFAULT_EVENT_TYPES = [
  { name:"Class",    color:"blue"   }, { name:"Deadline", color:"red"    },
  { name:"Reminder", color:"yellow" }, { name:"Meeting",  color:"brown"  },
  { name:"Event",    color:"purple" }, { name:"Other",    color:"gray"   },
].map(t=>({...t, hex:NOTION_COLOR_HEX[t.color]}))

// ─── Weather — Open-Meteo, no API key, CORS-enabled, called directly from
// the browser (no backend round-trip needed for this one). WMO codes cover
// the common cases; anything unmapped falls back to a plain cloud icon
// rather than guessing.
const WMO_WEATHER = {
  0:{label:"Clear",Icon:Sun}, 1:{label:"Mostly clear",Icon:Sun}, 2:{label:"Partly cloudy",Icon:Cloud}, 3:{label:"Overcast",Icon:Cloud},
  45:{label:"Fog",Icon:CloudFog}, 48:{label:"Fog",Icon:CloudFog},
  51:{label:"Light drizzle",Icon:CloudDrizzle}, 53:{label:"Drizzle",Icon:CloudDrizzle}, 55:{label:"Heavy drizzle",Icon:CloudDrizzle},
  61:{label:"Light rain",Icon:CloudRain}, 63:{label:"Rain",Icon:CloudRain}, 65:{label:"Heavy rain",Icon:CloudRain},
  71:{label:"Light snow",Icon:CloudSnow}, 73:{label:"Snow",Icon:CloudSnow}, 75:{label:"Heavy snow",Icon:CloudSnow},
  80:{label:"Showers",Icon:CloudRain}, 81:{label:"Showers",Icon:CloudRain}, 82:{label:"Violent showers",Icon:CloudRain},
  95:{label:"Thunderstorm",Icon:CloudLightning}, 96:{label:"Thunderstorm",Icon:CloudLightning}, 99:{label:"Thunderstorm",Icon:CloudLightning},
}
function wmoInfo(code){ return WMO_WEATHER[code] || {label:"—",Icon:Cloud} }

async function fetchWeather(lat, lon){
  const params = new URLSearchParams({
    latitude:lat, longitude:lon,
    current:"temperature_2m,weather_code",
    hourly:"temperature_2m,weather_code",
    daily:"temperature_2m_max,temperature_2m_min,weather_code",
    timezone:"auto", forecast_days:"3",
  })
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
  if(!r.ok) throw new Error(`Weather ${r.status}`)
  const d = await r.json()
  const nowIdx = Math.max(0, d.hourly.time.findIndex(t=>t.slice(0,13)===d.current.time.slice(0,13)))
  const hourly = d.hourly.time.slice(nowIdx,nowIdx+10).map((t,i)=>({
    time:t.slice(11,16), temp:Math.round(d.hourly.temperature_2m[nowIdx+i]), ...wmoInfo(d.hourly.weather_code[nowIdx+i])
  }))
  const daily = d.daily.time.slice(1,3).map((t,i)=>({
    date:t, max:Math.round(d.daily.temperature_2m_max[i+1]), min:Math.round(d.daily.temperature_2m_min[i+1]), ...wmoInfo(d.daily.weather_code[i+1])
  }))
  return { current:Math.round(d.current.temperature_2m), ...wmoInfo(d.current.weather_code), hourly, daily }
}

async function geocodeCity(name){
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1`)
  if(!r.ok) throw new Error("Geocoding failed")
  const d = await r.json()
  const m = d.results?.[0]
  if(!m) throw new Error(`"${name}" not found`)
  return { name:`${m.name}, ${m.country}`, lat:m.latitude, lon:m.longitude }
}

// CAT_COLOR still used throughout — derived from categories state at runtime
const STATIC_CAT_COLOR = Object.fromEntries(Object.entries(DEFAULT_CATS).map(([k,v])=>[k,v.color]))

const STATUS_COLOR = {
  "In progress": "#4B9E82",
  "Complete":    "#3A6A4A",
  "Not started": "#3A3A3A",
}

// ─── Projects-upgrade: priority, milestones, issues, budget ──────────────────
// Every project gets these capabilities for free, but nothing forces their
// use — a project with no budget set and no resources added just never
// shows that section. See taskDefaults/budgetStats below.
//
// Priority is signaled by amber INTENSITY, not a rainbow of hues — stays
// inside the existing dark+amber palette. Teal and red keep their original,
// narrow meanings (active/positive links, destructive actions) rather than
// getting overloaded with new ones like "this is high priority."
const AMBER_HEX = "#D4A843"
const PRIORITY_ALPHA = { low:"3D", medium:"8C", high:"FF" }
function priorityColor(p){ return AMBER_HEX + (PRIORITY_ALPHA[p]||PRIORITY_ALPHA.medium) }
const PRIORITY_ORDER = { high:0, medium:1, low:2 }

// Old tasks (created before this upgrade) are missing priority/kind/etc —
// this backfills sane defaults without ever touching stored data, so nothing
// needs a migration step.
function taskDefaults(t){
  return { priority:"medium", milestone:false, kind:"task", start:null, ...t }
}

// Auto-calculated spend vs budget — the one thing that's genuinely derived
// rather than user-entered.
// ─── Recursive node tree ──────────────────────────────────────────────────────
// A project IS a node; a page IS a node. Both are the same shape and both can
// hold children — more projects, more pages — arbitrarily deep, exactly like
// Notion's page-in-page model (deliberate: these port to real nested Notion
// pages). Leaf content (tasks, budget, files, links, notes, tables) lives on
// any node via its `sections`. No fixed template forces a shape: a finance
// tracker is just a node with table sections and nothing else.
function mapTree(nodes, id, fn){
  return nodes.map(n => n.id===id ? fn(n) : (n.children?.length ? {...n, children:mapTree(n.children,id,fn)} : n))
}
function findInTree(nodes, id){
  for(const n of nodes){ if(n.id===id) return n; if(n.children){ const f=findInTree(n.children,id); if(f) return f } }
  return null
}
function findPathInTree(nodes, id, trail=[]){
  for(const n of nodes){
    if(n.id===id) return [...trail,n]
    if(n.children){ const p=findPathInTree(n.children,id,[...trail,n]); if(p) return p }
  }
  return null
}

function budgetStats(p){
  const expenses = p.expenses||[]
  const spent = expenses.reduce((s,e)=>s+(Number(e.amount)||0),0)
  const budget = Number(p.budget)||0
  const pct = budget>0 ? Math.round((spent/budget)*100) : null
  return { spent, budget, pct, over: budget>0 && spent>budget, hasBudget: budget>0 }
}

const FILE_ICONS = {
  audio:  <Music size={13}/>,
  doc:    <FileText size={13}/>,
  stl:    <Box size={13}/>,
  pdf:    <FileText size={13}/>,
  link:   <Link2 size={13}/>,
  image:  <Image size={13}/>,
  code:   <Code2 size={13}/>,
  folder: <FolderTree size={13}/>,
  other:  <File size={13}/>,
}
const DEVICE_ICONS = {
  phone:  <Smartphone size={12}/>,
  laptop: <Monitor size={12}/>,
  pc:     <HardDrive size={12}/>,
  tv:     <Tv2 size={12}/>,
  cloud:  <Cloud size={12}/>,
}

// ─── Nav config (Lucide icons) ────────────────────────────────────────────────
const NAV_ITEMS = [
  { id:"dashboard", Icon:LayoutDashboard, label:"Dashboard" },
  { id:"projects",  Icon:Layers,          label:"Projects" },
  { id:"files",     Icon:FolderOpen,      label:"Files" },
  { id:"calendar",  Icon:CalendarDays,    label:"Calendar" },
  { id:"digest",    Icon:AlignLeft,       label:"Digest" },
  ...(UPLOADER_ENABLED?[{ id:"uploader",  Icon:Rocket,  label:"Uploader" }]:[]),
  { id:"settings",  Icon:Settings,        label:"Settings" },
]

// Category icon map
const CAT_ICONS = {
  brand:       <Tag size={11}/>,
  engineering: <Cpu size={11}/>,
  creative:    <Sparkles size={11}/>,
  music:       <Music size={11}/>,
  academic:    <BookOpen size={11}/>,
  other:       <File size={11}/>,
}

// ─── Seed data (from live Notion query) ───────────────────────────────────────
const SEED = [
  { id:"valle", title:"Valle Grail", emoji:"🔱", status:"In progress", category:"brand",
    notion_url:"https://app.notion.com/2eb8b2fbd65e803cbf37e93e99b6aaa9",
    description:"UK streetwear brand. Tapstitch manufacturer. 308 IG saves on key post.",
    subprojects:[
      {id:"v1",title:"Genesis",status:"Complete",deadline:null},
      {id:"v2",title:"Exodus",status:"In progress",deadline:"2026-09-01"},
    ], files:[] },
  { id:"mello", title:"Mello", emoji:"🚁", status:"In progress", category:"engineering",
    notion_url:"https://app.notion.com/24c8b2fbd65e80768b09e5bc9f81b534",
    description:"Extracurricular drone project.",
    subprojects:[
      {id:"m1",title:"Frame design",status:"In progress",deadline:null},
      {id:"m2",title:"Flight controller",status:"Not started",deadline:null},
      {id:"m3",title:"STL / CAD files",status:"Not started",deadline:null},
    ], files:[] },
  { id:"rift", title:"The Rift", emoji:"✍️", status:"Not started", category:"creative",
    notion_url:"https://app.notion.com/2028b2fbd65e810b942bf77c79701bba",
    description:"Creative writing / worldbuilding project.",
    subprojects:[], files:[] },
  { id:"tjoke", title:"The Terrific Joke", emoji:"🎭", status:"Not started", category:"creative",
    notion_url:"https://app.notion.com/2758b2fbd65e803e8a04ff2da4a3c032",
    description:"",
    subprojects:[], files:[] },
]

// ─── Module-level date utilities (used by both CalendarView and DigestView) ───
function ymd(d){ return d.toISOString().slice(0,10) }
function addD(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x }
function getMon(d){ const x=new Date(d); const diff=x.getDay()===0?-6:1-x.getDay(); x.setDate(x.getDate()+diff); x.setHours(0,0,0,0); return x }
function parseWeeksStr(s){
  if(!s) return []
  let excl=[], base=s
  const nm=s.match(/\(no\s*wk\s*([\d,\s]+)\)/i)
  if(nm){excl=nm[1].split(",").map(n=>parseInt(n.trim(),10)).filter(n=>!isNaN(n));base=s.replace(nm[0],"").trim()}
  const weeks=new Set()
  base.split(",").forEach(p=>{
    p=p.trim();if(!p)return
    const r=p.match(/^(\d+)\s*-\s*(\d+)$/)
    if(r){for(let i=parseInt(r[1],10);i<=parseInt(r[2],10);i++)weeks.add(i)}
    else{const n=parseInt(p,10);if(!isNaN(n))weeks.add(n)}
  })
  excl.forEach(n=>weeks.delete(n))
  return Array.from(weeks).sort((a,b)=>a-b)
}

// ─── Type icon registry — links category name to a Lucide icon component ──────
// Icons are tied to TYPE, not individual projects. All "music" projects share the music icon.
const TYPE_ICON_MAP = {
  // Core defaults
  brand:        "Shirt",
  engineering:  "Cpu",
  creative:     "Sparkles",
  music:        "Music",
  academic:     "BookOpen",
  other:        "File",
  // Extended — anyone can create these as new types
  finance:      "DollarSign",
  film:         "Film",
  photography:  "Camera",
  writing:      "Pen",
  design:       "Palette",
  code:         "Code2",
  fitness:      "Dumbbell",
  health:       "Heart",
  travel:       "Compass",
  social:       "Users",
  research:     "Microscope",
  business:     "Briefcase",
  art:          "Paintbrush",
  theatre:      "Drama",
  podcast:      "Mic",
  video:        "Video",
  gaming:       "Gamepad2",
  science:      "FlaskConical",
  law:          "Scale",
  cooking:      "UtensilsCrossed",
  fashion:      "Scissors",
  architecture: "Building2",
  sports:       "Trophy",
  language:     "Globe",
  teaching:     "GraduationCap",
  nonprofit:    "HandHeart",
  hardware:     "Wrench",
  marketing:    "Megaphone",
  reading:      "BookMarked",
  investing:    "TrendingUp",
  meditation:   "Sun",
  goal:         "Target",
  event:        "CalendarCheck",
}

// All available picker icons (subset that definitely exists in lucide-react 0.383.0)
const PICKER_ICONS = [
  "Shirt","Cpu","Sparkles","Music","BookOpen","File","DollarSign","Film","Camera",
  "Pen","Palette","Code2","Dumbbell","Heart","Compass","Users","Briefcase","Paintbrush",
  "Mic","Video","Scale","Scissors","Building2","Trophy","Globe","GraduationCap","Wrench",
  "Megaphone","TrendingUp","Sun","Target","Layers","Rocket","Lightbulb","Flame",
  "Star","Award","Zap","Shield","Coffee","Feather","Mountain","Gift","Hammer",
  "Headphones","Laptop","Medal","Radio","Ruler","Wallet","Leaf","Anchor",
  "FlaskConical","Crown","Key","Package","Newspaper","Flag","Map","Bookmark",
]

// ─── Gemini ───────────────────────────────────────────────────────────────────
// Goes through the backend's /api/gemini proxy — the raw key never touches
// the browser. apiBase/relayToken come from whichever call site invokes this
// (both are already in scope inside LifeOS(), where every call site lives).
async function gemini(apiBase, relayToken, system, user) {
  if (!apiBase) throw new Error("Set up your backend in Settings first.")
  const headers = {"Content-Type":"application/json"}
  if (relayToken) headers["Authorization"] = "Bearer "+relayToken
  const r = await fetch(`${apiBase}/api/gemini`, {
    method:"POST", credentials: relayToken?"omit":"include", headers,
    body: JSON.stringify({system, user}),
  })
  if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e?.error||`Gemini proxy ${r.status}`)}
  return (await r.json()).text
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600&family=JetBrains+Mono:wght@300;400&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
:root{
  --bg:#090909; --s1:#111; --s2:#181818; --s3:#222; --b:#2C2C2C;
  --t:#EBEBEB; --d:#7A7A7A; --m:#3C3C3C;
  --amber:#D4A843; --teal:#4B9E82; --red:#C05A4A;
  --sans:'Space Grotesk',sans-serif; --mono:'JetBrains Mono',monospace;
}
body,html{background:var(--bg);color:var(--t);font-family:var(--sans);}
input,select,textarea,button{font-family:var(--sans);}
::-webkit-scrollbar{width:3px;height:3px;}
::-webkit-scrollbar-track{background:transparent;}
::-webkit-scrollbar-thumb{background:var(--b);border-radius:2px;}

@keyframes breathe{
  0%,100%{border-color:rgba(212,168,67,.18);box-shadow:0 0 0 1px rgba(212,168,67,.06);}
  50%{border-color:rgba(212,168,67,.5);box-shadow:0 0 14px rgba(212,168,67,.09);}
}
@keyframes sd{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:translateY(0)}}
@keyframes fi{from{opacity:0}to{opacity:1}}
@keyframes pulse{0%,100%{opacity:.6}50%{opacity:1}}
@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}

.cmd-idle{animation:breathe 3.5s ease-in-out infinite;}
.cmd-live{border-color:var(--amber)!important;box-shadow:0 0 18px rgba(212,168,67,.13)!important;animation:none;}
.r-in{animation:sd .18s ease-out;}
.fi{animation:fi .15s ease-out;}
.processing span{animation:pulse 1s ease-in-out infinite;}
.hr:hover{background:var(--s2)!important;}
.nb:hover{background:rgba(255,255,255,.04)!important;}
.link-btn{color:var(--d);text-decoration:none;font-family:var(--mono);font-size:10px;border:1px solid var(--b);border-radius:3px;padding:2px 6px;cursor:pointer;}
.link-btn:hover{border-color:var(--d);}
a{color:inherit;}
`

// ─── Tiny helpers ─────────────────────────────────────────────────────────────
function Dot({color,size=6}){return<span style={{display:"inline-block",width:size,height:size,borderRadius:"50%",background:color,flexShrink:0}}/>}
function Eyebrow({children,style={}}){return<div style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)",letterSpacing:".08em",...style}}>{children}</div>}
function Badge({status}){
  const c=STATUS_COLOR[status]||"#3A3A3A"
  return<span style={{fontSize:"10px",fontFamily:"var(--mono)",color:c,background:c+"22",borderRadius:"3px",padding:"2px 6px",whiteSpace:"nowrap"}}>{status}</span>
}

// ─── Day utilization / time-allotment indicator ──────────────────────────────
// One row per event type present today, showing what portion of the day
// each has claimed and how much of it has already elapsed (live, ticks every
// 30s) — plus a "free" row for whatever's left before a cutoff. Colours come
// straight from the real event-type colours (Notion-parity), not invented
// here — this is the one place besides those types themselves where colour
// variety is the whole point, not noise.
function timeToMinutes(t){ if(!t) return null; const [h,m]=t.split(":").map(Number); return h*60+m }
function minutesToHM(mins){ const h=Math.floor(mins/60), m=Math.round(mins%60); return m===0?`${h}h`:`${h}h ${m}m` }
function daysUntilLabel(dateStr){
  const d=new Date(dateStr+"T00:00:00"), t=new Date(); t.setHours(0,0,0,0)
  const days=Math.round((d-t)/86400000)
  if(days===0) return "today"
  if(days===1) return "tomorrow"
  if(days<0) return "past"
  return `${days}d`
}
const DEFAULT_EVENT_DURATION_MIN = 60 // fallback when an event has no end time

function DayUtilization({ events, eventTypes }){
  const [nowMin, setNowMin] = useState(()=>{ const d=new Date(); return d.getHours()*60+d.getMinutes() })
  const [cutoffMinutes, setCutoffMinutes] = useState(()=>{
    try{ const v=Number(localStorage.getItem("lifeos_free_cutoff")); if(v>=12*60&&v<=24*60) return v }catch{}
    return 22*60
  })
  function saveCutoff(t){
    const m=timeToMinutes(t)
    if(m!=null&&m>=12*60&&m<=24*60){ setCutoffMinutes(m); try{localStorage.setItem("lifeos_free_cutoff",String(m))}catch{} }
  }
  useEffect(()=>{
    const id = setInterval(()=>{ const d=new Date(); setNowMin(d.getHours()*60+d.getMinutes()) }, 30000)
    return ()=>clearInterval(id)
  },[])

  const dayStart = 6*60
  const dayEnd = Math.max(cutoffMinutes, 23*60)
  const totalSpan = dayEnd - dayStart

  const byType = {}
  for(const ev of events){
    if(!ev.time) continue
    const start = timeToMinutes(ev.time)
    const end = ev.endTime ? timeToMinutes(ev.endTime) : start + DEFAULT_EVENT_DURATION_MIN
    if(end<=start) continue
    ;(byType[ev.type] ||= []).push({start,end})
  }

  // Free segments — walk busy periods in order, whatever's between them
  // (or after the last one, up to cutoff) is free. More accurate than a
  // single lump, since a busy slot later in the day still leaves real gaps.
  const windowStart = Math.max(nowMin, dayStart)
  const allBusy = Object.values(byType).flat().sort((a,b)=>a.start-b.start)
  const freeSegments = []
  let cursor = windowStart
  for(const seg of allBusy){
    if(seg.start>=cutoffMinutes) break
    if(seg.end<=cursor) continue
    if(seg.start>cursor) freeSegments.push({start:cursor,end:Math.min(seg.start,cutoffMinutes)})
    cursor = Math.max(cursor,seg.end)
  }
  if(cursor<cutoffMinutes) freeSegments.push({start:cursor,end:cutoffMinutes})
  const freeMinutes = freeSegments.reduce((s,seg)=>s+(seg.end-seg.start),0)

  function Bar({segments, color}){
    return (
      <div style={{position:"relative",height:"13px",background:"var(--s3)",borderRadius:"4px",overflow:"hidden",flex:1}}>
        {segments.map((seg,i)=>{
          const left = ((seg.start-dayStart)/totalSpan)*100
          const width = ((seg.end-seg.start)/totalSpan)*100
          const elapsed = Math.min(1,Math.max(0,(nowMin-seg.start)/(seg.end-seg.start)))
          return (
            <div key={i} style={{position:"absolute",left:left+"%",width:width+"%",top:0,bottom:0,borderRadius:"3px",overflow:"hidden",background:color+"2E"}}>
              <div style={{position:"absolute",left:0,top:0,bottom:0,width:(elapsed*100)+"%",background:color}}/>
            </div>
          )
        })}
        {nowMin>=dayStart && nowMin<=dayEnd && (
          <div style={{position:"absolute",left:((nowMin-dayStart)/totalSpan*100)+"%",top:0,bottom:0,width:"1px",background:"var(--amber)",opacity:.6}}/>
        )}
      </div>
    )
  }

  const activeTypes = eventTypes.filter(t=>byType[t.name]?.length)
  if(activeTypes.length===0 && freeMinutes>=totalSpan-5) return null // nothing to show — quiet day, don't clutter the UI

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"5px",padding:"10px 12px",background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"8px"}}>
      {activeTypes.map(t=>{
        const claimed = byType[t.name].reduce((s,seg)=>s+(seg.end-seg.start),0)
        return (
          <div key={t.name} style={{display:"flex",alignItems:"center",gap:"8px"}}>
            <span style={{width:"62px",fontSize:"9px",fontFamily:"var(--mono)",color:t.hex,flexShrink:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.name}</span>
            <Bar segments={byType[t.name]} color={t.hex}/>
            <span style={{fontSize:"9px",fontFamily:"var(--mono)",color:"var(--d)",flexShrink:0,width:"44px",textAlign:"right"}}>{minutesToHM(claimed)}</span>
          </div>
        )
      })}
      <div style={{display:"flex",alignItems:"center",gap:"8px",marginTop:activeTypes.length?"3px":0,paddingTop:activeTypes.length?"5px":0,borderTop:activeTypes.length?"1px solid var(--b)":"none"}}>
        <span style={{width:"62px",fontSize:"9px",fontFamily:"var(--mono)",color:"var(--teal)",flexShrink:0,display:"flex",alignItems:"center",gap:"3px"}}>
          free
          <input type="time" defaultValue={`${String(Math.floor(cutoffMinutes/60)).padStart(2,"0")}:${String(cutoffMinutes%60).padStart(2,"0")}`}
            onBlur={e=>saveCutoff(e.target.value)} title="free time counted until"
            style={{background:"transparent",border:"none",color:"var(--m)",fontFamily:"var(--mono)",fontSize:"8px",width:"38px",padding:0,outline:"none",colorScheme:"dark"}}/>
        </span>
        <Bar segments={freeSegments} color={"#4B9E82"}/>
        <span style={{fontSize:"9px",fontFamily:"var(--mono)",color:"var(--teal)",flexShrink:0,width:"44px",textAlign:"right"}}>{minutesToHM(freeMinutes)}</span>
      </div>
    </div>
  )
}

// ─── Gantt / timeline view ──────────────────────────────────────────────────
// Bars are directly draggable: whole-bar drag moves the task, the two edge
// handles resize start/deadline independently. No chart library — just plain
// mouse events, matching the rest of this app's zero-dependency philosophy.
// A stable top-level component (not defined inside a render), so its drag
// ref survives parent re-renders cleanly.
function GanttView({tasks, projId, updateTask}){
  const DAY_PX = 26
  const rowH = 30
  const dragRef = useRef(null)

  const today = new Date(); today.setHours(0,0,0,0)
  const dated = tasks.filter(t=>t.deadline)
  const allMs = dated.flatMap(t=>[t.start,t.deadline].filter(Boolean)).map(d=>new Date(d).getTime())
  const rangeStart = new Date(Math.min(today.getTime(), ...(allMs.length?allMs:[today.getTime()])))
  rangeStart.setDate(rangeStart.getDate()-4)
  const rangeEndMs = Math.max(today.getTime()+42*86400000, ...(allMs.length?allMs:[today.getTime()]))
  const totalDays = Math.round((rangeEndMs-rangeStart.getTime())/86400000)+7

  function xFor(dateStr){
    const d=new Date(dateStr); d.setHours(0,0,0,0)
    return Math.round((d-rangeStart)/86400000)*DAY_PX
  }
  function onMove(e){
    const d=dragRef.current
    if(!d||d.mode!=="move"||!d.el) return
    d.el.style.transform=`translateX(${e.clientX-d.startX}px)`
  }
  function onUp(e){
    const d=dragRef.current
    dragRef.current=null
    window.removeEventListener("mousemove",onMove)
    window.removeEventListener("mouseup",onUp)
    if(!d) return
    if(d.el) d.el.style.transform=""
    const deltaDays=Math.round((e.clientX-d.startX)/DAY_PX)
    if(deltaDays===0) return
    if(d.mode==="move"){
      const changes={deadline:ymd(addD(new Date(d.origEnd),deltaDays))}
      if(d.origStart) changes.start=ymd(addD(new Date(d.origStart),deltaDays))
      updateTask(projId,d.id,changes)
    }else if(d.mode==="end"){
      const nd=addD(new Date(d.origEnd),deltaDays)
      if(!d.origStart||nd>=new Date(d.origStart)) updateTask(projId,d.id,{deadline:ymd(nd)})
    }else if(d.mode==="start"){
      const ns=addD(new Date(d.origStart),deltaDays)
      if(ns<=new Date(d.origEnd)) updateTask(projId,d.id,{start:ymd(ns)})
    }
  }
  function onDown(e,t,mode,el){
    e.preventDefault();e.stopPropagation()
    dragRef.current={id:t.id,mode,startX:e.clientX,origStart:t.start,origEnd:t.deadline,el:el||null}
    window.addEventListener("mousemove",onMove)
    window.addEventListener("mouseup",onUp)
  }

  if(tasks.length===0){
    return <div style={{padding:"20px",fontSize:"12px",color:"var(--m)",fontStyle:"italic",
      background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"8px"}}>No tasks to plot yet.</div>
  }

  const weekTicks=[]
  for(let i=0;i<=totalDays;i+=7){
    weekTicks.push({x:i*DAY_PX,label:addD(rangeStart,i).toLocaleDateString(undefined,{month:"short",day:"numeric"})})
  }
  const todayX=Math.round((today-rangeStart)/86400000)*DAY_PX

  return (
    <div style={{background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"8px",display:"flex",overflow:"hidden"}}>
      <div style={{width:"150px",flexShrink:0,borderRight:"1px solid var(--b)"}}>
        <div style={{height:"26px",borderBottom:"1px solid var(--b)"}}/>
        {tasks.map(t=>(
          <div key={t.id} style={{height:rowH+"px",display:"flex",alignItems:"center",gap:"5px",
            padding:"0 10px",borderBottom:"1px solid var(--b)",fontSize:"11px",overflow:"hidden"}}>
            {t.kind==="issue"?<Bug size={10} color="var(--d)" strokeWidth={1.5}/>:t.milestone?<Star size={10} color="var(--amber)" fill="var(--amber)" strokeWidth={1.5}/>:null}
            <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</span>
          </div>
        ))}
      </div>
      <div style={{overflowX:"auto",flex:1}}>
        <div style={{position:"relative",width:totalDays*DAY_PX+"px"}}>
          <div style={{height:"26px",borderBottom:"1px solid var(--b)",position:"relative"}}>
            {weekTicks.map(w=>(
              <span key={w.x} style={{position:"absolute",left:w.x+4,top:"6px",fontSize:"9px",fontFamily:"var(--mono)",color:"var(--m)"}}>{w.label}</span>
            ))}
          </div>
          <div style={{position:"absolute",left:todayX,top:0,bottom:0,width:"1px",background:"var(--amber)",opacity:.5,zIndex:1}}/>
          {tasks.map(t=>{
            const hasStart=!!t.start
            const isMilestone = t.milestone||!hasStart
            return (
              <div key={t.id} style={{height:rowH+"px",position:"relative",borderBottom:"1px solid var(--b)"}}>
                {t.deadline&&(isMilestone?(
                  <div onMouseDown={e=>onDown(e,t,"end",null)}
                    title={`${t.title} — ${t.deadline}`}
                    style={{position:"absolute",left:xFor(t.deadline)-5,top:"9px",width:"11px",height:"11px",
                      transform:"rotate(45deg)",background:priorityColor(t.priority),cursor:"ew-resize"}}/>
                ):(
                  <div onMouseDown={e=>onDown(e,t,"move",e.currentTarget)}
                    title={`${t.start} → ${t.deadline}`}
                    style={{position:"absolute",left:xFor(t.start),top:"8px",
                      width:Math.max(DAY_PX*0.7,xFor(t.deadline)-xFor(t.start)+DAY_PX*0.7)+"px",
                      height:"13px",borderRadius:"3px",background:AMBER_HEX+"1A",
                      border:`1px solid ${priorityColor(t.priority)}`,cursor:"grab"}}>
                    <div onMouseDown={e=>onDown(e,t,"start",null)} style={{position:"absolute",left:0,top:0,bottom:0,width:"6px",cursor:"ew-resize"}}/>
                    <div onMouseDown={e=>onDown(e,t,"end",null)} style={{position:"absolute",right:0,top:0,bottom:0,width:"6px",cursor:"ew-resize"}}/>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── One row in the Settings tab for a paste-a-token service (Canvas, monday,
// Gemini, ntfy) — a real top-level component so its input state survives
// LifeOS's re-renders cleanly, same reasoning as GanttView above.
function ApiKeyRow({spec, connected, onSave, onDisconnect, isLast}){
  const [values,setValues] = useState({})
  return (
    <div style={{padding:"10px 14px",borderBottom:isLast?"none":"1px solid var(--b)"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:connected?0:"6px"}}>
        <span style={{fontSize:"12px"}}>{spec.label}</span>
        {connected&&(
          <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
            <span style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--teal)"}}>✓ connected</span>
            <button onClick={onDisconnect} style={{background:"none",border:"none",cursor:"pointer",color:"var(--d)",padding:0}}><X size={12}/></button>
          </div>
        )}
      </div>
      {!connected&&spec.hint&&(
        <div style={{fontSize:"9px",fontFamily:"var(--mono)",color:"var(--d)",lineHeight:"1.5",marginBottom:"7px"}}>{spec.hint}</div>
      )}
      {!connected&&spec.links&&(
        <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"7px"}}>
          {spec.links.map(l=>(
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer"
              style={{fontSize:"9px",fontFamily:"var(--mono)",color:"var(--amber)",background:"rgba(212,168,67,.08)",
                border:"1px solid rgba(212,168,67,.3)",borderRadius:"4px",padding:"3px 8px",textDecoration:"none"}}>
              {l.label}
            </a>
          ))}
        </div>
      )}
      {!connected&&(
        <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
          {spec.fields.map(f=>(
            <input key={f.key} placeholder={f.ph} onChange={e=>setValues(v=>({...v,[f.key]:e.target.value}))}
              style={{flex:"1 1 120px",background:"var(--s3)",color:"var(--t)",border:"1px solid var(--b)",borderRadius:"4px",padding:"5px 8px",fontSize:"11px"}}/>
          ))}
          <button onClick={()=>onSave(values)}
            style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--t)",background:"var(--s2)",border:"1px solid var(--amber)55",borderRadius:"4px",padding:"5px 10px",cursor:"pointer"}}>
            connect
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Main app ─────────────────────────────────────────────────────────────────
export default function LifeOS(){
  const [tab,setTab]   = useState("dashboard")
  const [projects,setProjects] = useState(SEED)
  const [files,setFiles] = useState([])
  const [sel,setSel]   = useState(null)
  const [categories,setCategories] = useState(DEFAULT_CATS) // extensible
  const [editingTitle,setEditingTitle] = useState(null)
  // Pull from Notion the moment a project/page is opened — if it's already
  // synced, this checks for remote changes and applies them before the user
  // sees the detail view. Silent no-op if nothing changed.
  useEffect(()=>{
    if(sel?.notion_page_id) pullFromNotion(sel.id).catch(()=>{})
  },[sel?.id])
  const [editingProj,setEditingProj] = useState(null)
  const [editingTask,setEditingTask] = useState(null) // project id being renamed
  const [cmd,setCmd]   = useState("")
  const [result,setResult] = useState(null)
  const [busy,setBusy] = useState(false)
  const [focused,setFocused] = useState(false)
  const [device,setDevice] = useState("laptop")
  const [addFileFor,setAddFileFor] = useState(null)
  const [addProjOpen,setAddProjOpen] = useState(false)
  const [taskView,setTaskView] = useState("list")           // list | kanban | timeline
  const [taskKindFilter,setTaskKindFilter] = useState("all") // all | task | issue
  const [scrapeResult,setScrapeResult] = useState(null)      // {url,goal,answer} from the research agent
  const cmdRef = useRef(null)
  const rtimer = useRef(null)

  // ── Backend connector (worker.js — auth, vault, Cloudflare BYOC) ─────────
  // This is now the ONLY credential system — the old client-side
  // gemKey/mondayToken/notionWorkerUrl/canvasToken/canvasDomain fields (and
  // the SetupWizard/SettingsModal that configured them) have been retired.
  // They were a second, unsynced place to "connect" things that silently
  // never touched the real backend — confusing in exactly the way it sounds.
  const [apiBase,setApiBase] = useState(DEFAULT_API_BASE)
  const [me,setMe] = useState(null)       // { user, deployment } from /api/me, or null if signed out
  const [creds,setCreds] = useState([])   // from /api/credentials
  const [cfg,setCfg] = useState({})       // from /api/config
  const [eventTypes,setEventTypes] = useState(DEFAULT_EVENT_TYPES) // synced from Notion's own schema once connected
  const [settingsBusy,setSettingsBusy] = useState(false)
  const [settingsMsg,setSettingsMsg] = useState("")

  function backendBase(){ return me?.deployment?.worker_url || apiBase }
  async function backendFetch(path, opts={}){
    const base = backendBase()
    if(!base) throw new Error("Set your backend URL first")
    const usingRelay = !!me?.deployment?.relay_token
    return fetch(base+path, {
      ...opts,
      credentials: usingRelay ? "omit" : "include",
      headers: {
        "Content-Type":"application/json",
        ...(usingRelay?{"Authorization":"Bearer "+me.deployment.relay_token}:{}),
        ...(opts.headers||{}),
      },
    })
  }
  async function refreshMe(){
    if(!apiBase) { setMe(null); return }
    try{
      const r = await fetch(apiBase+"/api/me", { credentials:"include" })
      setMe(r.ok ? await r.json() : null)
    }catch{ setMe(null) }
  }
  async function refreshCreds(){
    try{ const r=await backendFetch("/api/credentials"); if(r.ok) setCreds((await r.json()).credentials) }catch{}
  }
  async function refreshCfg(){
    try{ const r=await backendFetch("/api/config"); if(r.ok) setCfg((await r.json()).config) }catch{}
  }
  function saveApiBase(v){
    const clean = v.replace(/\/+$/,"")
    setApiBase(clean)
    try{ localStorage.setItem("lifeos_api_base", clean) }catch{}
  }
  async function saveConfigKey(key, value){
    const next = {...cfg,[key]:value}; setCfg(next)
    try{ await backendFetch("/api/config", {method:"PUT", body:JSON.stringify({[key]:value})}) }catch{}
  }
  async function saveApiKeyCred(service, payload){
    setSettingsBusy(true); setSettingsMsg("")
    try{
      const r = await backendFetch(`/api/credentials/${service}`, {method:"POST", body:JSON.stringify(payload)})
      if(r.ok){ setSettingsMsg(`${service} connected`); refreshCreds() }
      else setSettingsMsg((await r.json()).error||"Failed to connect")
    }catch(e){ setSettingsMsg(e.message) } finally{ setSettingsBusy(false) }
  }
  async function disconnectService(service){
    try{ await backendFetch(`/api/credentials/${service}`, {method:"DELETE"}); refreshCreds() }catch{}
  }
  async function provisionNow(){
    setSettingsBusy(true); setSettingsMsg("Provisioning your own Cloudflare deployment — this takes a moment...")
    try{
      const r = await backendFetch("/api/provision", {method:"POST"})
      const d = await r.json()
      if(d.ok){ setSettingsMsg("Deployed. Switching to your own backend..."); await refreshMe() }
      else setSettingsMsg(d.error||"Provisioning failed")
    }catch(e){ setSettingsMsg(e.message) } finally{ setSettingsBusy(false) }
  }

  useEffect(()=>{
    try{ const saved=localStorage.getItem("lifeos_api_base"); if(saved) setApiBase(saved) }catch{}
  },[])
  useEffect(()=>{ refreshMe() },[apiBase])
  useEffect(()=>{ if(me?.user){ refreshCreds(); refreshCfg() } },[me])
  useEffect(()=>{
    if(apiBase && creds.some(c=>c.service==="notion")){
      fetchNotionEventTypes().then(types=>{ if(types?.length) setEventTypes(types) }).catch(()=>{})
    }
  },[apiBase, creds])

  // ── Persistence ─────────────────────────────────────────────────────
  useEffect(()=>{
    try{
      const d=JSON.parse(localStorage.getItem(LS_KEY)||"{}")
      if(d.projects?.length) setProjects(d.projects)
      if(d.files) setFiles(d.files)
      if(d.device) setDevice(d.device)
      if(d.categories) setCategories({...DEFAULT_CATS,...d.categories})
    }catch{}
  },[])

  // Derived — category colour map, always reflects current categories state
  const CAT_COLOR = Object.fromEntries(Object.entries(categories).map(([k,v])=>[k,v.color||"#666"]))

  const save = useCallback((patch={})=>{
    const cur={projects,files,device,categories,...patch}
    try{localStorage.setItem(LS_KEY,JSON.stringify(cur))}catch{}
  },[projects,files,device,categories])

  // ── Result banner ────────────────────────────────────────────────────
  function flash(text,type="ok"){
    if(rtimer.current) clearTimeout(rtimer.current)
    setResult({text,type})
    rtimer.current=setTimeout(()=>setResult(null),4500)
  }

  // Rename a project in-place and update Notion title if possible
  function renameProject(id, newTitle){
    const trimmed = newTitle.trim()
    if (!trimmed) return
    const np = mapTree(projects, id, p=>({...p,title:trimmed}))
    setProjects(np)
    if(sel?.id===id) setSel({...sel,title:trimmed})
    save({projects:np})
    setEditingTitle(null)
    // Best-effort Notion title update (only if notion_url is set — means it exists in Notion)
    if(apiBase && creds.some(c=>c.service==="notion")){
      const p = findInTree(np, id)
      if(p?.notion_url){
        const pageId = p.notion_url.split("/").pop()?.replace(/[^a-f0-9]/g,"")
        if(pageId){
          backendFetch(`/proxy/notion/v1/pages/${pageId}`,{
            method:"PATCH",
            body:JSON.stringify({properties:{title:{title:[{text:{content:p.emoji+" "+trimmed}}]}}})
          }).catch(()=>{}) // silent — rename is already saved locally
        }
      }
    }
  }

  // ── Node CRUD — one recursive updater, every helper rides it, and every
  // helper therefore works at ANY depth of the tree, not just top level ────
  function updateNode(nodeId, fn){
    const np = mapTree(projects, nodeId, fn)
    setProjects(np)
    if(sel?.id===nodeId) setSel(fn(sel))
    save({projects:np})
  }
  function updateTask(projId, taskId, changes){ updateNode(projId, p=>({...p,subprojects:(p.subprojects||[]).map(x=>x.id===taskId?{...x,...changes}:x)})) }
  function addTask(projId, task){
    const t = taskDefaults({id:"t_"+Date.now(),title:"New task",status:"Not started",deadline:null,...task})
    updateNode(projId, p=>({...p,subprojects:[...(p.subprojects||[]),t]}))
    return t
  }
  function deleteTask(projId, taskId){ updateNode(projId, p=>({...p,subprojects:(p.subprojects||[]).filter(x=>x.id!==taskId)})) }
  function setBudget(projId, budget){ updateNode(projId, p=>({...p,budget})) }
  function addExpense(projId, expense){ updateNode(projId, p=>({...p,expenses:[...(p.expenses||[]),expense]})) }
  function updateExpense(projId, expId, changes){ updateNode(projId, p=>({...p,expenses:(p.expenses||[]).map(x=>x.id===expId?{...x,...changes}:x)})) }
  function deleteExpense(projId, expId){ updateNode(projId, p=>({...p,expenses:(p.expenses||[]).filter(x=>x.id!==expId)})) }
  function addResource(projId, resource){ updateNode(projId, p=>({...p,resources:[...(p.resources||[]),resource]})) }
  function updateResource(projId, resId, changes){ updateNode(projId, p=>({...p,resources:(p.resources||[]).map(x=>x.id===resId?{...x,...changes}:x)})) }
  function deleteResource(projId, resId){ updateNode(projId, p=>({...p,resources:(p.resources||[]).filter(x=>x.id!==resId)})) }

  // Projects created before this feature existed have no `sections` field —
  // fall back per node type rather than treating them as blank.
  function sectionsOf(p){ return p?.sections || (p?.type==="page" ? ["notes"] : ["tasks"]) }
  function addSection(projId, key){ updateNode(projId, p=>sectionsOf(p).includes(key)?p:{...p,sections:[...sectionsOf(p),key]}) }
  // Removing a section only hides it — the underlying data stays put, so
  // re-adding brings it right back. Always a safe, undoable click.
  function removeSection(projId, key){ updateNode(projId, p=>({...p,sections:sectionsOf(p).filter(s=>s!==key)})) }
  function addLink(projId, link){ updateNode(projId, p=>({...p,links:[...(p.links||[]),link]})) }
  function updateLink(projId, linkId, changes){ updateNode(projId, p=>({...p,links:(p.links||[]).map(x=>x.id===linkId?{...x,...changes}:x)})) }
  function deleteLink(projId, linkId){ updateNode(projId, p=>({...p,links:(p.links||[]).filter(x=>x.id!==linkId)})) }
  function updateNotes(projId, notes){ updateNode(projId, p=>({...p,notes})) }

  // ── Tables — a simple editable grid leaf, stored as {id,title,cols,rows} ──
  function addTable(projId){
    const t = {id:"tb_"+Date.now(), title:"New table", cols:["Column 1","Column 2"], rows:[["",""]]}
    updateNode(projId, p=>({...p,tables:[...(p.tables||[]),t]}))
  }
  function updateTable(projId, tableId, fn){ updateNode(projId, p=>({...p,tables:(p.tables||[]).map(t=>t.id===tableId?fn(t):t)})) }
  function deleteTable(projId, tableId){ updateNode(projId, p=>({...p,tables:(p.tables||[]).filter(t=>t.id!==tableId)})) }

  // ── Charts — derived views over a table's data, not a separate dataset.
  // A chart points at a table + a label column + a numeric value column;
  // edit the table and the chart follows. Data drives the UI, literally.
  function addChart(projId, chart){ updateNode(projId, p=>({...p,charts:[...(p.charts||[]),chart]})) }
  function updateChart(projId, chartId, changes){ updateNode(projId, p=>({...p,charts:(p.charts||[]).map(c=>c.id===chartId?{...c,...changes}:c)})) }
  function deleteChart(projId, chartId){ updateNode(projId, p=>({...p,charts:(p.charts||[]).filter(c=>c.id!==chartId)})) }

  // ── Children — projects within projects, pages within pages, any depth ───
  function addChild(parentId, type){
    const child = type==="page"
      ? {id:"n_"+Date.now(), type:"page", title:"New page", sections:["notes"], children:[], status:"Not started", category:null, subprojects:[], files:[]}
      : {id:"n_"+Date.now(), type:"project", title:"New project", sections:["tasks"], children:[], status:"Not started",
         category:(findInTree(projects,parentId)?.category)||"other", subprojects:[], files:[]}
    updateNode(parentId, p=>({...p,children:[...(p.children||[]),child]}))
    setSel(child)
    return child
  }
  function deleteChild(parentId, childId){ updateNode(parentId, p=>({...p,children:(p.children||[]).filter(c=>c.id!==childId)})) }
  // Delete any node — root or nested — with its whole subtree. Confirmed at
  // the call site; roots come off the top-level list, nested via parent.
  function deleteNodeAnywhere(nodeId){
    const path = findPathInTree(projects, nodeId)
    if(!path) return
    if(path.length===1){
      const np = projects.filter(p=>p.id!==nodeId)
      setProjects(np); save({projects:np})
    }else{
      deleteChild(path[path.length-2].id, nodeId)
    }
    if(sel?.id===nodeId) setSel(path.length>1?path[path.length-2]:null)
  }

  // Create project in Notion Project Planner database
  async function createNotionProject(p){
    if(!apiBase || !creds.some(c=>c.service==="notion")) return null
    try{
      const PLANNER_DB = "2028b2fb-d65e-81da-8e5f-000b35af0b12"
      const catConf = categories[p.category]||{emoji:"📁"}
      const r = await backendFetch(`/proxy/notion/v1/pages`,{
        method:"POST",
        body:JSON.stringify({
          parent:{database_id:PLANNER_DB},
          icon:{type:"emoji",emoji:p.emoji},
          properties:{
            title:{title:[{text:{content:p.emoji+" "+p.title}}]},
            // Tags property carries the category — works with existing Project Planner schema
            ...(PLANNER_DB&&{Tags:{multi_select:[{name:p.category}]}})
          }
        })
      })
      if(r.ok){ const d=await r.json(); return {url:d.url||null, pageId:d.id||null} }
    }catch{}
    return null
  }

  // ── Nested Notion sync — the tree ports to REAL nested Notion pages,
  // using Notion's own page-in-page model rather than a parallel flat
  // structure. Containers → child pages, tables → child databases (rows as
  // entries), notes → paragraph blocks. Best-effort and resumable: nodes
  // that already have a notion_page_id are skipped, so re-running sync
  // only pushes what's new.
  async function notionCreateChildPage(parentPageId, node){
    const r = await backendFetch(`/proxy/notion/v1/pages`,{
      method:"POST",
      body:JSON.stringify({
        parent:{page_id:parentPageId},
        ...(node.type!=="page"&&{icon:{type:"emoji",emoji:"📁"}}),
        properties:{title:{title:[{text:{content:node.title}}]}},
      })
    })
    if(!r.ok) throw new Error(`Notion page create ${r.status}`)
    return (await r.json()).id
  }
  async function notionCreateChildTable(parentPageId, tb){
    const props = {}
    tb.cols.forEach((c,i)=>{ props[c||`Column ${i+1}`] = i===0 ? {title:{}} : {rich_text:{}} })
    const r = await backendFetch(`/proxy/notion/v1/databases`,{
      method:"POST",
      body:JSON.stringify({ parent:{type:"page_id",page_id:parentPageId}, title:[{text:{content:tb.title}}], properties:props })
    })
    if(!r.ok) throw new Error(`Notion db create ${r.status}`)
    const dbId = (await r.json()).id
    for(const row of tb.rows){
      const rowProps = {}
      tb.cols.forEach((c,i)=>{
        const key = c||`Column ${i+1}`
        rowProps[key] = i===0 ? {title:[{text:{content:row[i]||""}}]} : {rich_text:[{text:{content:row[i]||""}}]}
      })
      await backendFetch(`/proxy/notion/v1/pages`,{method:"POST",body:JSON.stringify({parent:{database_id:dbId},properties:rowProps})}).catch(()=>{})
    }
    return dbId
  }
  async function notionAppendNotes(pageId, notes){
    await backendFetch(`/proxy/notion/v1/blocks/${pageId}/children`,{
      method:"PATCH",
      body:JSON.stringify({children:[{object:"block",type:"paragraph",paragraph:{rich_text:[{text:{content:notes.slice(0,1900)}}]}}]})
    }).catch(()=>{})
  }
  async function syncTreeToNotion(nodeId){
    if(!apiBase || !creds.some(c=>c.service==="notion")){ flash("Connect Notion in Settings first.","warn"); return }
    setBusy(true)
    try{
      let count=0
      async function walk(node, parentPageId){
        let pageId = node.notion_page_id
        if(!pageId && parentPageId){
          pageId = await notionCreateChildPage(parentPageId, node)
          updateNode(node.id, n=>({...n, notion_page_id:pageId}))
          count++
          if(node.notes) await notionAppendNotes(pageId, node.notes)
          for(const tb of (node.tables||[])) await notionCreateChildTable(pageId, tb).catch(()=>{})
        }
        if(pageId) for(const c of (node.children||[])) await walk(c, pageId)
      }
      const root = findInTree(projects, nodeId)
      if(!root) return
      let rootPageId = root.notion_page_id
      if(!rootPageId){
        const created = await createNotionProject(root)
        if(created?.pageId){
          rootPageId = created.pageId
          updateNode(root.id, n=>({...n, notion_url:created.url, notion_page_id:created.pageId}))
          count++
          if(root.notes) await notionAppendNotes(rootPageId, root.notes)
          for(const tb of (root.tables||[])) await notionCreateChildTable(rootPageId, tb).catch(()=>{})
        }
      }
      if(rootPageId) for(const c of (root.children||[])) await walk(c, rootPageId)
      flash(count?`Synced ${count} node(s) to Notion.`:"Already fully synced.","ok")
    }catch(e){ flash("Notion sync failed: "+e.message,"warn") }
    finally{ setBusy(false) }
  }

  // ── Pull from Notion — called whenever a project/page is opened or the
  // user hits "sync". Diffs Notion's current state against local and applies
  // only what actually changed — so quick re-opens are silent no-ops, and
  // nothing gets clobbered that the user edited locally since last pull.
  // Revision log (last 20 versions per node) is stored in localStorage so
  // nothing is silently lost when Notion wins a conflict.
  const REV_LS_KEY = "lifeos_revisions"
  function saveRevision(nodeId, snapshot){
    try{
      const all = JSON.parse(localStorage.getItem(REV_LS_KEY)||"{}")
      const revs = (all[nodeId]||[]).slice(0,19)   // keep 20, drop oldest
      revs.unshift({...snapshot, saved_at:new Date().toISOString()})
      all[nodeId] = revs
      localStorage.setItem(REV_LS_KEY, JSON.stringify(all))
    }catch{}
  }
  function loadRevisions(nodeId){
    try{ return JSON.parse(localStorage.getItem(REV_LS_KEY)||"{}")[nodeId]||[] }catch{ return [] }
  }

  async function pullFromNotion(nodeId, verbose=false){
    if(!apiBase || !creds.some(c=>c.service==="notion")) return
    const node = findInTree(projects, nodeId)
    if(!node?.notion_page_id) return     // not yet synced to Notion — nothing to pull

    try{
      // Fetch the Notion page itself
      const r = await backendFetch(`/proxy/notion/v1/pages/${node.notion_page_id}`)
      if(!r.ok) return
      const page = await r.json()

      // Pull paragraph blocks (notes)
      const blocksR = await backendFetch(`/proxy/notion/v1/blocks/${node.notion_page_id}/children?page_size=100`)
      const blocks = blocksR.ok ? (await blocksR.json()).results||[] : []
      const notionNotes = blocks
        .filter(b=>b.type==="paragraph")
        .map(b=>b.paragraph?.rich_text?.map(t=>t.plain_text||"").join("")||"")
        .join("\n").trim()

      // Pull title
      const notionTitle = page.properties?.title?.title?.[0]?.plain_text
        || page.properties?.Name?.title?.[0]?.plain_text
        || node.title

      // Pull child databases → tables
      const childDBs = blocks.filter(b=>b.type==="child_database")
      const notionTables = []
      for(const db of childDBs){
        try{
          const dbR = await backendFetch(`/proxy/notion/v1/databases/${db.id}`)
          const rowsR = await backendFetch(`/proxy/notion/v1/databases/${db.id}/query`,{method:"POST",body:JSON.stringify({page_size:100})})
          if(!dbR.ok||!rowsR.ok) continue
          const dbMeta = await dbR.json()
          const rowsData = await rowsR.json()
          // Reconstruct columns from property order, title first
          const props = dbMeta.properties||{}
          const cols = Object.keys(props).sort((a,b)=>props[a].type==="title"?-1:props[b].type==="title"?1:0)
          const rows = (rowsData.results||[]).map(pg=>
            cols.map(c=>{
              const v = pg.properties?.[c]
              if(!v) return ""
              if(v.type==="title") return v.title?.[0]?.plain_text||""
              if(v.type==="rich_text") return v.rich_text?.[0]?.plain_text||""
              if(v.type==="number") return String(v.number??"")
              return ""
            })
          )
          // Match against existing table by title to preserve local id
          const existing = (node.tables||[]).find(t=>t.title===dbMeta.title?.[0]?.plain_text)
          notionTables.push({
            id: existing?.id||"tb_"+db.id.replace(/-/g,"").slice(0,8),
            title: dbMeta.title?.[0]?.plain_text||"Table",
            notion_db_id: db.id,
            cols, rows
          })
        }catch{}
      }

      // Diff — only update fields that actually changed, don't touch
      // fields Notion doesn't know about (local-only: subprojects, charts, etc.)
      const notionEditedAt = page.last_edited_time
      const localEditedAt = node.notion_last_edited_at

      // If Notion hasn't changed since we last pulled, skip silently
      if(localEditedAt && localEditedAt===notionEditedAt) return

      const changes = { notion_last_edited_at: notionEditedAt }
      if(notionTitle !== node.title) changes.title = notionTitle
      if(notionNotes && notionNotes !== (node.notes||"")) changes.notes = notionNotes
      if(notionTables.length){
        // Merge: tables pulled from Notion replace matched ones, preserving unmatched local tables
        const unmatched = (node.tables||[]).filter(t=>!t.notion_db_id&&!notionTables.find(nt=>nt.id===t.id))
        changes.tables = [...notionTables, ...unmatched]
      }

      if(Object.keys(changes).length>1){
        // Save the previous state to revision log before overwriting
        saveRevision(nodeId, {title:node.title, notes:node.notes, tables:node.tables})
        updateNode(nodeId, n=>({...n,...changes}))
        flash("Updated from Notion — previous version in revision history.","ok")
      }else if(verbose){
        flash("Already up to date with Notion.","ok")
      }

      // Recurse into children that are already synced
      for(const child of (node.children||[])){
        if(child.notion_page_id) await pullFromNotion(child.id).catch(()=>{})
      }
    }catch{}    // Silent — a failed pull never breaks the UI
  }

  // ── Smart import from Notion — Gemini sees the data BEFORE the user does.
  // Instead of dumping a Notion page in as one blob of notes, the raw content
  // goes through Gemini first, which decides the best presentation: what's
  // genuinely tabular → tables, what's a list of URLs → links, what deserves
  // a chart, what stays prose. Falls back to a plain title+notes import if
  // the structuring step fails — never blocks on the AI.
  async function importFromNotion(pageUrlOrId){
    if(!apiBase || !creds.some(c=>c.service==="notion")){ flash("Connect Notion in Settings first.","warn"); return }
    const idMatch = pageUrlOrId.replace(/-/g,"").match(/([a-f0-9]{32})/i)
    if(!idMatch){ flash("Couldn't find a Notion page id in that.","warn"); return }
    const pageId = idMatch[1]
    setBusy(true)
    try{
      const r = await backendFetch(`/proxy/notion/v1/pages/${pageId}`)
      if(!r.ok) throw new Error(`Notion ${r.status} — is that page shared with the integration?`)
      const page = await r.json()
      const blocksR = await backendFetch(`/proxy/notion/v1/blocks/${pageId}/children?page_size=100`)
      const blocks = blocksR.ok ? (await blocksR.json()).results||[] : []
      const title = Object.values(page.properties||{}).find(p=>p.type==="title")?.title?.[0]?.plain_text || "Imported page"
      const rawText = blocks.map(b=>{
        const rt=b[b.type]?.rich_text; return rt?rt.map(t=>t.plain_text||"").join(""):""
      }).filter(Boolean).join("\n")

      // Gemini decides presentation — only if connected; otherwise plain import
      let structured = null
      if(creds.some(c=>c.service==="gemini") && rawText.trim()){
        try{
          const raw = await gemini(apiBase, me?.deployment?.relay_token,
            "You organize imported content into the best data presentation. Analyze the content and restructure it — genuinely tabular data becomes tables, lists of URLs become links, numeric series worth visualizing get a chart spec, the rest stays as notes. Don't force structure that isn't there.",
            `Page title: ${title}\n\nContent:\n${rawText.slice(0,8000)}\n\nReturn ONLY this JSON, no fences:\n{"notes":"prose that should stay prose","tables":[{"title":"","cols":[""],"rows":[[""]]}],"links":[{"label":"","url":""}],"chart":{"tableTitle":"","labelCol":"","valueCol":""}|null,"sections":["notes"|"tables"|"links"|"charts"|"tasks"]}`
          )
          structured = JSON.parse(raw.replace(/^```json\s*/i,"").replace(/^```\s*/i,"").replace(/```\s*$/i,"").trim())
        }catch{} // structuring failed → plain import below
      }

      const tables = (structured?.tables||[]).filter(t=>t.cols?.length&&t.rows?.length).map((t,i)=>({id:"tb_imp"+Date.now()+i, title:t.title||"Table", cols:t.cols, rows:t.rows}))
      const links = (structured?.links||[]).filter(l=>l.url).map((l,i)=>({id:"lk_imp"+Date.now()+i, label:l.label||l.url, url:l.url}))
      const charts = []
      if(structured?.chart?.tableTitle){
        const tb = tables.find(t=>t.title===structured.chart.tableTitle)
        if(tb) charts.push({id:"ch_imp"+Date.now(), title:tb.title+" chart", tableId:tb.id, labelCol:structured.chart.labelCol, valueCol:structured.chart.valueCol})
      }
      const sections = structured?.sections?.length ? [...new Set(structured.sections)] : ["notes"]

      const node = {
        id:"n_imp"+Date.now(), type:"page", title,
        notion_page_id:pageId, notion_url:page.url||null, notion_last_edited_at:page.last_edited_time,
        sections, notes:structured?.notes ?? rawText, tables, links, charts,
        children:[], subprojects:[], files:[], status:"Not started", category:null,
      }
      const np=[node,...projects]
      setProjects(np); save({projects:np}); setSel(node); setTab("projects")
      flash(structured?`Imported "${title}" — Gemini organized it into ${sections.join(", ")}.`:`Imported "${title}" as notes.`,"ok")
    }catch(e){ flash("Import failed: "+e.message,"warn") }
    finally{ setBusy(false) }
  }

  // ── Command handler ──────────────────────────────────────────────────
  async function runCmd(e){
    e.preventDefault()
    if(!cmd.trim()||busy) return

    // Direct scrape command — "scrape <url> for <goal>" needs no intent
    // parsing, so it skips the Gemini round-trip and hits the research
    // agent directly. Watch variant: "watch <url> daily/weekly for <goal>".
    const scrapeMatch = cmd.trim().match(/^(scrape|watch)\s+(\S+)\s+(daily|weekly)?\s*(?:for|:)\s+(.+)$/i)
    if(scrapeMatch){
      if(!apiBase||!creds.some(c=>c.service==="gemini")){setTab("settings");flash("Connect Gemini in Settings first.","warn");return}
      const [,verb,rawUrl,freq,goal]=scrapeMatch
      const url = rawUrl.startsWith("http")?rawUrl:`https://${rawUrl}`
      setBusy(true)
      try{
        if(verb.toLowerCase()==="watch"){
          const r=await backendFetch("/api/watch",{method:"POST",body:JSON.stringify({url,goal,frequency:freq?.toLowerCase()||"daily"})})
          const d=await r.json()
          if(d.ok) flash(`Watching ${url} ${freq||"daily"} — results go to your digest/ntfy.`,"ok")
          else flash(d.error||"Couldn't create watch job","warn")
        }else{
          const r=await backendFetch("/api/scrape",{method:"POST",body:JSON.stringify({url,goal})})
          const d=await r.json()
          if(d.ok) setScrapeResult({url,goal,answer:d.result.answer})
          else flash(d.error||"Scrape failed","warn")
        }
      }catch(err){ flash(err.message,"warn") }
      finally{ setBusy(false); setCmd("") }
      return
    }

    if(!apiBase||!creds.some(c=>c.service==="gemini")){setTab("settings");flash("Connect Gemini in Settings first.","warn");return}
    setBusy(true)
    try{
      const sys=`You are the intelligence layer of LifeOS, a personal data management OS.
Current projects: ${JSON.stringify(projects.map(p=>({id:p.id,title:p.title,category:p.category,status:p.status})))}
Current device: ${device}

Parse the user's natural-language command and return ONLY a JSON object, nothing else.
Be smart: you can do everything the user can do in the UI, plus more. Prefer action over asking for clarification.
{
  "type": "create_project"|"add_task"|"add_file"|"edit_project"|"edit_task"|"delete_task"|"update_status"|"respond",
  "params": { ... },
  "response": "one short direct sentence"
}

Action params:
- create_project: {title,emoji,category(brand/engineering/creative/music/academic/other),description}
- add_task: {projectId(match from list),title,status("Not started"|"In progress"|"Complete"),deadline(YYYY-MM-DD or null)}
- add_file: {projectId(match from list or null),name,type(audio/doc/stl/pdf/link/image/code/other),device(phone/laptop/pc/tv/cloud),path(url or local path description)}
- update_status: {projectId,status}
- edit_project: {projectId, changes:{title?,category?,status?,description?}}
- edit_task: {projectId, taskId(match by title), changes:{title?,status?,deadline?}}
- delete_task: {projectId, taskId}
- respond: {} — for questions, comments, anything that doesn't map to above

Be smart: fuzzy-match project titles to IDs, infer categories and types intelligently.`

      const raw=await gemini(apiBase,me?.deployment?.relay_token,sys,cmd)
      let action
      try{
        const clean=raw.replace(/^```json\s*/i,"").replace(/^```\s*/i,"").replace(/```\s*$/i,"").trim()
        action=JSON.parse(clean)
      }catch{action={type:"respond",params:{},response:raw.slice(0,200)}}

      let np=[...projects], nf=[...files]

      if(action.type==="create_project"){
        const p={id:"p_"+Date.now(),title:action.params.title||"Untitled",emoji:action.params.emoji||"📁",
          status:"Not started",category:action.params.category||"other",notion_url:null,
          description:action.params.description||"",subprojects:[],files:[]}
        np=[...projects,p]
        setProjects(np)
        setTab("projects")
        setSel(p)
        // Mirror to Notion Project Planner (async, silent on failure)
        createNotionProject(p).then(created=>{
          if(created?.url){
            const withUrl=np.map(x=>x.id===p.id?{...x,notion_url:created.url,notion_page_id:created.pageId}:x)
            setProjects(withUrl)
            save({projects:withUrl})
          }
        })
      }else if(action.type==="add_task"){
        const pid=action.params.projectId
        const matched=projects.find(p=>p.id===pid||p.title.toLowerCase().includes((pid||"").toLowerCase()))
        if(matched){
          np=projects.map(p=>p.id===matched.id
            ?{...p,subprojects:[...p.subprojects,{id:"t_"+Date.now(),title:action.params.title,
              status:action.params.status||"Not started",deadline:action.params.deadline||null}]}
            :p)
          setProjects(np)
          setTab("projects")
          setSel(np.find(p=>p.id===matched.id))
        }
      }else if(action.type==="add_file"){
        const fp={id:"fp_"+Date.now(),...action.params,createdAt:new Date().toISOString()}
        nf=[...files,fp]
        setFiles(nf)
      }else if(action.type==="update_status"){
        const pid=action.params.projectId
        np=projects.map(p=>p.id===pid||p.title.toLowerCase().includes((pid||"").toLowerCase())
          ?{...p,status:action.params.status}:p)
        setProjects(np)
      }else if(action.type==="edit_project"){
        const pid=action.params.projectId
        const ch=action.params.changes||{}
        np=projects.map(p=>{
          if(p.id===pid||p.title.toLowerCase().includes((pid||"").toLowerCase()))
            return{...p,...(ch.title&&{title:ch.title}),...(ch.category&&{category:ch.category}),...(ch.status&&{status:ch.status}),...(ch.description!==undefined&&{description:ch.description})}
          return p
        })
        setProjects(np)
        if(sel){const updated=np.find(p=>p.id===sel.id);if(updated)setSel(updated)}
      }else if(action.type==="edit_task"){
        const pid=action.params.projectId
        const tid=action.params.taskId
        const ch=action.params.changes||{}
        np=projects.map(p=>{
          if(!(p.id===pid||p.title.toLowerCase().includes((pid||"").toLowerCase()))) return p
          return{...p,subprojects:p.subprojects.map(t=>{
            if(t.id===tid||t.title.toLowerCase().includes((tid||"").toLowerCase()))
              return{...t,...(ch.title&&{title:ch.title}),...(ch.status&&{status:ch.status}),...(ch.deadline!==undefined&&{deadline:ch.deadline})}
            return t
          })}
        })
        setProjects(np)
        if(sel){const updated=np.find(p=>p.id===sel.id);if(updated)setSel(updated)}
      }else if(action.type==="delete_task"){
        const pid=action.params.projectId
        const tid=action.params.taskId
        np=projects.map(p=>{
          if(!(p.id===pid||p.title.toLowerCase().includes((pid||"").toLowerCase()))) return p
          return{...p,subprojects:p.subprojects.filter(t=>t.id!==tid&&!t.title.toLowerCase().includes((tid||"").toLowerCase()))}
        })
        setProjects(np)
        if(sel){const updated=np.find(p=>p.id===sel.id);if(updated)setSel(updated)}
      }

      save({projects:np,files:nf})
      flash(action.response)
      setCmd("")
    }catch(e){flash("Error: "+e.message,"err")}
    finally{setBusy(false)}
  }

  // ── Nav config ───────────────────────────────────────────────────────
  // NAV_ITEMS defined at module level, uses Lucide icons

  // ─────────────────────────────────────────────────────────────────────
  // VIEWS
  // ─────────────────────────────────────────────────────────────────────

  function Dashboard(){
    const active = projects.filter(p=>p.status==="In progress")
    const upcoming = projects.flatMap(p=>p.subprojects.filter(s=>s.deadline))
      .sort((a,b)=>a.deadline>b.deadline?1:-1).slice(0,6)
    const totalTasks = projects.flatMap(p=>p.subprojects).length
    const doneTasks  = projects.flatMap(p=>p.subprojects).filter(s=>s.status==="Complete").length
    const [canvas,setCanvas] = useState(null)
    const hasCanvas = creds.some(c=>c.service==="canvas")
    useEffect(()=>{ if(hasCanvas) fetchCanvasSummary().then(setCanvas) },[hasCanvas])

    // Progress bar — driven by sub-tasks
    function Progress({p}){
      const total=p.subprojects.length, done=p.subprojects.filter(s=>s.status==="Complete").length
      if(!total) return <span style={{fontSize:"9px",fontFamily:"var(--mono)",color:"var(--m)"}}>—</span>
      const pct=Math.round(done/total*100)
      const cc=CAT_COLOR[p.category]||"#666"
      return(
        <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
          <div style={{width:"52px",height:"2px",background:"var(--b)",borderRadius:"1px",overflow:"hidden"}}>
            <div style={{height:"100%",width:pct+"%",background:cc,transition:"width .4s"}}/>
          </div>
          <span style={{fontSize:"9px",fontFamily:"var(--mono)",color:"var(--d)"}}>{done}/{total}</span>
        </div>
      )
    }

    // Editable title — double click to rename
    function EditableTitle({p, style={}}){
      const isEditing = editingTitle===p.id
      const inputRef = useRef(null)
      useEffect(()=>{ if(isEditing) setTimeout(()=>inputRef.current?.select(),50) },[isEditing])
      if(isEditing) return(
        <input ref={inputRef} defaultValue={p.title}
          onBlur={e=>renameProject(p.id,e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter") renameProject(p.id,e.target.value);if(e.key==="Escape") setEditingTitle(null)}}
          onClick={e=>e.stopPropagation()}
          style={{...style,background:"var(--s3)",color:"var(--t)",border:"1px solid var(--amber)",
            borderRadius:"4px",padding:"1px 5px",fontFamily:"var(--sans)",fontWeight:"500",outline:"none",width:"90%"}}/>
      )
      return <div style={style} onDoubleClick={e=>{e.stopPropagation();setEditingTitle(p.id)}} title="double-click to rename">{p.title}</div>
    }

    return(
      <div style={{height:"100%",display:"flex",flexDirection:"column",overflow:"hidden"}}>

        {/* Live status ticker */}
        {active.length>0&&(
          <div style={{borderBottom:"1px solid var(--b)",padding:"5px 20px",display:"flex",alignItems:"center",gap:"0",flexShrink:0,overflow:"hidden"}}>
            <span style={{fontSize:"9px",fontFamily:"var(--mono)",color:"var(--amber)",marginRight:"14px",letterSpacing:".1em",flexShrink:0}}>LIVE</span>
            <div style={{display:"flex",gap:"20px",overflow:"hidden",WebkitMaskImage:"linear-gradient(to right,transparent,black 4%,black 93%,transparent)"}}>
              {active.map(p=>{
                const cc=CAT_COLOR[p.category]||"#666"
                const next=p.subprojects.find(s=>s.status==="In progress")||p.subprojects.find(s=>s.status==="Not started")
                return(
                  <span key={p.id} onClick={()=>{setTab("projects");setSel(p)}}
                    style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)",cursor:"pointer",
                      whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:"6px",transition:"color .1s"}}
                    onMouseEnter={e=>e.currentTarget.style.color=cc}
                    onMouseLeave={e=>e.currentTarget.style.color="var(--d)"}>
                    <LucideIcon name={catIconName(p.category,categories)} size={10} color={cc}/>
                    {p.title}
                    {next&&<span style={{color:"var(--m)"}}>· {next.title.length>22?next.title.slice(0,20)+"…":next.title}</span>}
                  </span>
                )
              })}
            </div>
          </div>
        )}

        {/* Body: grid + focus column */}
        <div style={{flex:1,display:"grid",gridTemplateColumns:"1fr 248px",overflow:"hidden"}}>

          {/* Projects — MIXED: summary strip + card grid */}
          <div style={{padding:"18px 22px 18px 20px",overflowY:"auto",borderRight:"1px solid var(--b)"}}>

            {/* Summary strip */}
            <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:"16px"}}>
              <div>
                <div style={{fontSize:"16px",fontWeight:"300",letterSpacing:"-.02em",marginBottom:"2px"}}>
                  {new Date().toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"})}
                </div>
                <div style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)"}}>
                  {active.length} active · {totalTasks-doneTasks} tasks open · {files.length} files
                </div>
              </div>
            </div>

            {/* Card grid — 2 columns, cards have individual visual presence */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:"10px"}}>
              {projects.filter(p=>{
            if(projCatFilter!=="all"&&p.category!==projCatFilter) return false
            if(projSearch&&!p.title.toLowerCase().includes(projSearch.toLowerCase())) return false
            return true
          }).map(p=>{
                const cc=CAT_COLOR[p.category]||"#666"
                const catConf=categories[p.category]||{emoji:"📁"}
                const dim=p.status==="Not started"
                const tasksDone=p.subprojects.filter(s=>s.status==="Complete").length
                const tasksTotal=p.subprojects.length
                return(
                  <div key={p.id} onClick={()=>{setTab("projects");setSel(p)}}
                    style={{background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"8px",
                      padding:"13px 14px",cursor:"pointer",position:"relative",overflow:"hidden",
                      opacity:dim?.58:1,transition:"all .15s"}}
                    onMouseEnter={e=>{e.currentTarget.style.borderColor=cc;e.currentTarget.style.opacity="1"}}
                    onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--b)";e.currentTarget.style.opacity=dim?.58:1}}>
                    {/* Accent edge */}
                    <div style={{position:"absolute",top:0,left:0,width:"3px",height:"100%",background:cc,borderRadius:"8px 0 0 8px"}}/>
                    {/* Card content */}
                    <div style={{paddingLeft:"8px"}}>
                      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:"8px"}}>
                        <LucideIcon name={catIconName(p.category,categories)} size={18} color={cc}/>
                        <span style={{fontSize:"9px",fontFamily:"var(--mono)",color:cc,letterSpacing:".04em",
                          background:cc+"15",padding:"2px 5px",borderRadius:"3px"}}>{p.category}</span>
                      </div>
                      <EditableTitle p={p} style={{fontSize:"13px",fontWeight:"500",marginBottom:"3px",lineHeight:1.3}}/>
                      {p.description&&<div style={{fontSize:"10px",color:"var(--d)",marginBottom:"8px",
                        overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"100%"}}>{p.description}</div>}
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:"auto"}}>
                        <Progress p={p}/>
                        <Badge status={p.status}/>
                      </div>
                      {p.notion_url&&(
                        <a href={p.notion_url} target="_blank" rel="noreferrer"
                          onClick={e=>e.stopPropagation()}
                          style={{position:"absolute",top:"10px",right:"10px",fontSize:"9px",fontFamily:"var(--mono)",
                            color:"var(--m)",textDecoration:"none"}}
                          onMouseEnter={e=>e.currentTarget.style.color=cc}
                          onMouseLeave={e=>e.currentTarget.style.color="var(--m)"}>↗</a>
                      )}
                    </div>
                  </div>
                )
              })}

              {/* Add card */}
              <div onClick={()=>setAddProjOpen(true)}
                style={{background:"transparent",border:"1px dashed var(--b)",borderRadius:"8px",
                  padding:"13px 14px",cursor:"pointer",display:"flex",alignItems:"center",
                  justifyContent:"center",color:"var(--m)",fontSize:"12px",fontFamily:"var(--mono)",
                  minHeight:"80px",transition:"border-color .15s,color .15s"}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--amber)";e.currentTarget.style.color="var(--amber)"}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--b)";e.currentTarget.style.color="var(--m)"}}>
                + new project
              </div>
              {creds.some(c=>c.service==="notion")&&(
                <div onClick={()=>{const u=prompt("Paste a Notion page link (the page must be shared with your LifeOS integration):");if(u) importFromNotion(u)}}
                  title="Gemini reads the page first and organizes it — tables become tables, links become links, prose stays prose"
                  style={{background:"transparent",border:"1px dashed var(--b)",borderRadius:"8px",
                    padding:"13px 14px",cursor:"pointer",display:"flex",flexDirection:"column",gap:"3px",alignItems:"center",
                    justifyContent:"center",color:"var(--m)",fontSize:"12px",fontFamily:"var(--mono)",
                    minHeight:"80px",transition:"border-color .15s,color .15s"}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--amber)";e.currentTarget.style.color="var(--amber)"}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--b)";e.currentTarget.style.color="var(--m)"}}>
                  <span>⇣ import from notion</span>
                  <span style={{fontSize:"8px",opacity:.7}}>gemini organizes it first</span>
                </div>
              )}
            </div>
          </div>

          {/* Right focus column */}
          <div style={{padding:"18px 15px",overflowY:"auto",display:"flex",flexDirection:"column",gap:"18px"}}>

            <div>
              <Eyebrow style={{marginBottom:"9px"}}>UPCOMING</Eyebrow>
              {upcoming.length===0?(
                <div style={{fontSize:"10px",color:"var(--m)",fontFamily:"var(--mono)"}}>no deadlines set</div>
              ):upcoming.map((s,i)=>{
                const dL=s.deadline?Math.round((new Date(s.deadline)-new Date())/86400000):null
                const hot=dL!==null&&dL<=3
                return(
                  <div key={s.id} style={{padding:"6px 0",borderBottom:i<upcoming.length-1?"1px solid var(--b)":"none",
                    display:"flex",justifyContent:"space-between",gap:"8px",alignItems:"baseline"}}>
                    <span style={{fontSize:"11px",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.title}</span>
                    <span style={{fontSize:"9px",fontFamily:"var(--mono)",color:hot?"var(--amber)":"var(--d)",flexShrink:0}}>
                      {dL===0?"today":dL===1?"tmrw":s.deadline}
                    </span>
                  </div>
                )
              })}
            </div>

            <div>
              <Eyebrow style={{marginBottom:"9px"}}>TRY</Eyebrow>
              <div style={{display:"flex",flexDirection:"column",gap:"4px"}}>
                {[
                  "create project: Blacksand EP",
                  "add task to Mello: order ESC",
                  "remind me to take vitamin D in 1h",
                  "mark Exodus as complete",
                ].map(s=>(
                  <button key={s} onClick={()=>{setCmd(s);cmdRef.current?.focus()}}
                    style={{background:"transparent",border:"1px solid var(--b)",borderRadius:"4px",
                      padding:"5px 8px",fontSize:"9px",fontFamily:"var(--mono)",color:"var(--d)",
                      cursor:"pointer",textAlign:"left",transition:"all .1s",lineHeight:1.4}}
                    onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--amber)";e.currentTarget.style.color="var(--t)"}}
                    onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--b)";e.currentTarget.style.color="var(--d)"}}>
                    ↳ {s}
                  </button>
                ))}
              </div>
            </div>

            <div style={{marginTop:"auto"}}>
              <a href={NOTION_CAL_URL} target="_blank" rel="noreferrer"
                style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                  padding:"8px 10px",background:"var(--s1)",border:"1px solid var(--b)",
                  borderRadius:"5px",fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)",
                  textDecoration:"none",transition:"border-color .1s"}}
                onMouseEnter={e=>e.currentTarget.style.borderColor="var(--amber)"}
                onMouseLeave={e=>e.currentTarget.style.borderColor="var(--b)"}>
                <span>Notion Calendar</span><span style={{color:"var(--m)"}}>↗</span>
              </a>
            </div>
          </div>

          {/* Canvas panel — only shown when Canvas is connected */}
          {hasCanvas&&(
            <div style={{marginLeft:"16px",width:"220px",flexShrink:0,display:"flex",flexDirection:"column",gap:"10px",overflowY:"auto"}}>
              <Eyebrow>CANVAS</Eyebrow>
              {!canvas?(
                <div style={{fontSize:"10px",color:"var(--m)",fontStyle:"italic"}}>Loading…</div>
              ):(
                <>
                  {/* Upcoming deadlines */}
                  {(canvas.deadlines||[]).length>0&&(
                    <div>
                      <div style={{fontSize:"9px",fontFamily:"var(--mono)",color:"var(--d)",marginBottom:"5px"}}>UPCOMING</div>
                      <div style={{display:"flex",flexDirection:"column",gap:"3px"}}>
                        {(canvas.deadlines||[]).slice(0,6).map(d=>{
                          const urgent=d.days_until<=1
                          const soon=d.days_until<=3
                          const color=urgent?"#e05555":soon?"var(--amber)":"var(--d)"
                          return(
                            <a key={d.id} href={d.html_url} target="_blank" rel="noreferrer"
                              style={{display:"block",background:"var(--s1)",border:`1px solid ${urgent?"rgba(224,85,85,.3)":soon?"rgba(212,168,67,.25)":"var(--b)"}`,
                                borderRadius:"5px",padding:"6px 8px",textDecoration:"none"}}>
                              <div style={{fontSize:"10px",color:"var(--t)",lineHeight:1.3,marginBottom:"2px"}}>{d.title}</div>
                              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                                <span style={{fontSize:"8px",fontFamily:"var(--mono)",color:"var(--m)"}}>{d.course_name.length>18?d.course_name.slice(0,18)+"…":d.course_name}</span>
                                <span style={{fontSize:"8px",fontFamily:"var(--mono)",color,fontWeight:urgent?"600":"400"}}>
                                  {d.days_until===0?"today":d.days_until===1?"tomorrow":`${d.days_until}d`}
                                </span>
                              </div>
                            </a>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Courses with grades */}
                  {(canvas.courses||[]).length>0&&(
                    <div>
                      <div style={{fontSize:"9px",fontFamily:"var(--mono)",color:"var(--d)",marginBottom:"5px"}}>COURSES</div>
                      <div style={{display:"flex",flexDirection:"column",gap:"2px"}}>
                        {(canvas.courses||[]).map(c=>(
                          <div key={c.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                            padding:"5px 8px",background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"5px"}}>
                            <span style={{fontSize:"9px",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:"var(--t)"}}>{c.name}</span>
                            <div style={{display:"flex",alignItems:"center",gap:"5px",flexShrink:0,marginLeft:"6px"}}>
                              {c.grade&&<span style={{fontSize:"8px",fontFamily:"var(--mono)",color:"var(--teal)"}}>{c.grade}</span>}
                              <button onClick={()=>importCanvasCourse(c, canvas.deadlines)}
                                title="Import as LifeOS project with deadlines as tasks"
                                style={{background:"none",border:"none",cursor:"pointer",color:"var(--m)",padding:0,display:"flex"}}>
                                <Download size={9}/>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Announcements */}
                  {(canvas.announcements||[]).length>0&&(
                    <div>
                      <div style={{fontSize:"9px",fontFamily:"var(--mono)",color:"var(--d)",marginBottom:"5px"}}>ANNOUNCEMENTS</div>
                      <div style={{display:"flex",flexDirection:"column",gap:"2px"}}>
                        {(canvas.announcements||[]).slice(0,3).map(a=>(
                          <a key={a.id} href={a.html_url} target="_blank" rel="noreferrer"
                            style={{display:"block",padding:"5px 8px",background:"var(--s1)",border:"1px solid var(--b)",
                              borderRadius:"5px",textDecoration:"none"}}>
                            <div style={{fontSize:"9px",color:"var(--t)",lineHeight:1.3}}>{a.title}</div>
                            <div style={{fontSize:"8px",fontFamily:"var(--mono)",color:"var(--m)",marginTop:"1px"}}>{a.course_name.length>22?a.course_name.slice(0,22)+"…":a.course_name}</div>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {(canvas.deadlines||[]).length===0&&(canvas.courses||[]).length===0&&(
                    <div style={{fontSize:"10px",color:"var(--m)",fontStyle:"italic"}}>Nothing upcoming — clear schedule.</div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }
  // ── Shared filter state (lives at LifeOS level so tabs remember it) ──────────
  const [projCatFilter,setProjCatFilter] = useState("all")
  const [filesTypeFilter,setFilesTypeFilter] = useState("all")
  const [filesDevFilter,setFilesDevFilter] = useState("all")
  const [projSearch,setProjSearch] = useState("")

  function ProjectFilter(){
    const cats = ["all", ...Object.keys(categories)]
    return(
      <div style={{padding:"0 4px 8px"}}>
        <div style={{display:"flex",alignItems:"center",gap:"5px",marginBottom:"6px",
          background:"var(--s2)",border:"1px solid var(--b)",borderRadius:"5px",padding:"5px 8px"}}>
          <Search size={11} color="var(--d)" strokeWidth={1.5}/>
          <input value={projSearch} onChange={e=>setProjSearch(e.target.value)}
            placeholder="search projects..."
            style={{flex:1,background:"transparent",border:"none",color:"var(--t)",fontSize:"11px",outline:"none",fontFamily:"var(--mono)"}}/>
          {projSearch&&<button onClick={()=>setProjSearch("")} style={{background:"none",border:"none",cursor:"pointer",color:"var(--m)",padding:0}}><X size={10}/></button>}
        </div>
        <div style={{display:"flex",gap:"4px",flexWrap:"wrap"}}>
          {cats.map(c=>{
            const cc=c==="all"?"var(--d)":(CAT_COLOR[c]||"#888")
            return(
              <button key={c} onClick={()=>setProjCatFilter(c)}
                style={{fontSize:"9px",fontFamily:"var(--mono)",padding:"3px 7px",borderRadius:"999px",border:"1px solid",cursor:"pointer",
                  borderColor:projCatFilter===c?cc:"var(--b)",
                  background:projCatFilter===c?cc+"22":"transparent",
                  color:projCatFilter===c?cc:"var(--m)"}}>
                {c}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  function Projects(){
    return(
      <div style={{display:"grid",gridTemplateColumns:sel?"240px 1fr":"240px 1fr",height:"100%",overflow:"hidden"}}>
        {/* List */}
        <div style={{borderRight:"1px solid var(--b)",overflowY:"auto",padding:"14px 10px"}}>
          <div style={{padding:"6px 10px 0",marginBottom:"6px"}}>
            <Eyebrow>PROJECTS</Eyebrow>
          </div>
          <ProjectFilter/>
          {projects.map(p=>{
            const cc=CAT_COLOR[p.category]||"#666"
            const active=sel?.id===p.id
            return(
              <div key={p.id} onClick={()=>setSel(active?null:p)}
                style={{padding:"9px 10px",borderRadius:"6px",cursor:"pointer",marginBottom:"3px",
                  display:"flex",alignItems:"center",gap:"8px",
                  background:active?"var(--s2)":"transparent",
                  borderLeft:active?"2px solid var(--amber)":"2px solid transparent",
                  transition:"all .1s"}}
                className={active?"":"hr"}>
                <LucideIcon name={catIconName(p.category,categories)} size={14} color={CAT_COLOR[p.category]||"#666"}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:"12px",fontWeight:"500",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.title}</div>
                  <div style={{fontSize:"10px",fontFamily:"var(--mono)",color:cc,marginTop:"1px"}}>{p.category}</div>
                </div>
                <Dot color={cc} size={5}/>
              </div>
            )
          })}
          <div onClick={()=>setAddProjOpen(true)}
            style={{padding:"9px 10px",borderRadius:"6px",cursor:"pointer",fontSize:"12px",color:"var(--m)",
              border:"1px dashed var(--b)",textAlign:"center",marginTop:"8px"}} className="hr">
            + new project
          </div>
        </div>

        {/* Detail */}
        {sel?(()=>{
          const liveSel = findInTree(projects, sel.id) || sel
          const path = findPathInTree(projects, sel.id) || [liveSel]
          const visibleTasks = (liveSel.subprojects||[]).map(taskDefaults).filter(t=>taskKindFilter==="all"||t.kind===taskKindFilter)
          const bStats = budgetStats(liveSel)
          const selNode = liveSel
          return (
          <div style={{overflowY:"auto",padding:"24px 28px"}} className="fi" key={sel.id+(liveSel.notion_last_edited_at||"")}>
            {/* Breadcrumbs — only shown once you're actually inside something */}
            {path.length>1&&(
              <div style={{display:"flex",alignItems:"center",gap:"4px",marginBottom:"12px",flexWrap:"wrap"}}>
                {path.map((n,i)=>(
                  <span key={n.id} style={{display:"flex",alignItems:"center",gap:"4px"}}>
                    {i>0&&<ChevronRight size={10} color="var(--m)"/>}
                    {i<path.length-1?(
                      <button onClick={()=>setSel(n)}
                        style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)",background:"none",border:"none",cursor:"pointer",padding:"2px 3px"}}>
                        {n.title}
                      </button>
                    ):(
                      <span style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--amber)",padding:"2px 3px"}}>{n.title}</span>
                    )}
                  </span>
                ))}
              </div>
            )}
            {/* Header */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"22px"}}>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"4px"}}>
                <LucideIcon name={catIconName(sel.category,categories)} size={20} color={CAT_COLOR[sel.category]||"#666"}/>
                <span style={{fontSize:"18px",fontWeight:"500"}}>{sel.title}</span>
              </div>
                {sel.description&&<div style={{fontSize:"12px",color:"var(--d)",maxWidth:"440px",lineHeight:"1.5"}}>{sel.description}</div>}
              </div>
              <div style={{display:"flex",gap:"6px",alignItems:"center",flexShrink:0}}>
                <Badge status={sel.status}/>
                {sel.notion_url&&<a href={sel.notion_url} target="_blank" rel="noreferrer" className="link-btn">notion ↗</a>}
                {creds.some(c=>c.service==="notion")&&(
                  <span style={{display:"flex",alignItems:"center",gap:"6px"}}>
                    <button onClick={async()=>{ await syncTreeToNotion(sel.id); await pullFromNotion(sel.id, true) }}
                      disabled={busy} title="Push local changes to Notion, then pull any remote changes back"
                      style={{display:"flex",alignItems:"center",gap:"4px",fontSize:"10px",fontFamily:"var(--mono)",
                        color:"var(--d)",background:"var(--s2)",border:"1px solid var(--b)",borderRadius:"4px",padding:"3px 8px",cursor:busy?"default":"pointer",opacity:busy?.6:1}}>
                      <RefreshCw size={9} strokeWidth={1.5}/> sync
                    </button>
                    <span style={{fontSize:"8px",fontFamily:"var(--mono)",color:sel.notion_page_id?"var(--teal)":"var(--m)"}}>
                      {sel.notion_page_id
                        ? `two-way · auto-pulls on open${sel.notion_last_edited_at?" · notion edited "+new Date(sel.notion_last_edited_at).toLocaleString("en-GB",{dateStyle:"short",timeStyle:"short"}):""}`
                        : "not in notion yet — sync pushes it"}
                    </span>
                  </span>
                )}
                <button onClick={()=>{if(confirm(`Delete "${sel.title}"${(sel.children||[]).length?" and everything inside it":""}? This can't be undone.`)) deleteNodeAnywhere(sel.id)}}
                  title="Delete this project/page"
                  style={{background:"none",border:"none",cursor:"pointer",color:"var(--m)",padding:"3px",display:"flex"}}>
                  <X size={12}/>
                </button>
                <button onClick={()=>setEditingProj(sel.id===editingProj?null:sel.id)}
                  style={{display:"flex",alignItems:"center",gap:"4px",fontSize:"10px",fontFamily:"var(--mono)",
                    color:sel.id===editingProj?"var(--amber)":"var(--d)",background:"var(--s2)",
                    border:"1px solid var(--b)",borderRadius:"4px",padding:"3px 8px",cursor:"pointer"}}>
                  <Edit3 size={9} strokeWidth={1.5}/> edit
                </button>
              </div>
            </div>

            {/* Inline edit form */}
            {editingProj===sel.id&&(
              <div style={{background:"var(--s2)",border:"1px solid var(--amber)33",borderRadius:"8px",padding:"14px",marginBottom:"16px"}} className="fi">
                <Eyebrow style={{marginBottom:"10px",color:"var(--amber)"}}>EDITING PROJECT</Eyebrow>
                <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                  <div>
                    <Eyebrow style={{marginBottom:"3px"}}>TITLE</Eyebrow>
                    <input defaultValue={sel.title}
                      onBlur={e=>{if(e.target.value.trim()&&e.target.value!==sel.title) renameProject(sel.id,e.target.value)}}
                      style={{width:"100%",background:"var(--s3)",color:"var(--t)",border:"1px solid var(--b)",borderRadius:"5px",padding:"7px 9px",fontSize:"13px"}}/>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
                    <div>
                      <Eyebrow style={{marginBottom:"3px"}}>TYPE</Eyebrow>
                      <select value={sel.category} onChange={e=>{
                          const np=projects.map(p=>p.id===sel.id?{...p,category:e.target.value}:p)
                          setProjects(np);setSel({...sel,category:e.target.value});save({projects:np})
                        }}
                        style={{width:"100%",background:"var(--s3)",color:"var(--t)",border:"1px solid var(--b)",borderRadius:"5px",padding:"7px 8px",fontSize:"12px"}}>
                        {Object.keys(categories).map(k=><option key={k} value={k}>{k}</option>)}
                      </select>
                    </div>
                    <div>
                      <Eyebrow style={{marginBottom:"3px"}}>STATUS</Eyebrow>
                      <select value={sel.status} onChange={e=>{
                          const np=projects.map(p=>p.id===sel.id?{...p,status:e.target.value}:p)
                          setProjects(np);setSel({...sel,status:e.target.value});save({projects:np})
                        }}
                        style={{width:"100%",background:"var(--s3)",color:"var(--t)",border:"1px solid var(--b)",borderRadius:"5px",padding:"7px 8px",fontSize:"12px"}}>
                        {["Not started","In progress","Complete"].map(s=><option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <Eyebrow style={{marginBottom:"3px"}}>DESCRIPTION</Eyebrow>
                    <input defaultValue={sel.description}
                      onBlur={e=>{
                        const np=projects.map(p=>p.id===sel.id?{...p,description:e.target.value}:p)
                        setProjects(np);setSel({...sel,description:e.target.value});save({projects:np})
                      }}
                      style={{width:"100%",background:"var(--s3)",color:"var(--t)",border:"1px solid var(--b)",borderRadius:"5px",padding:"7px 9px",fontSize:"12px"}}/>
                  </div>
                  <button onClick={()=>setEditingProj(null)}
                    style={{alignSelf:"flex-end",fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)",background:"transparent",border:"1px solid var(--b)",borderRadius:"4px",padding:"4px 10px",cursor:"pointer"}}>
                    done
                  </button>
                </div>
              </div>
            )}

            {/* Contents — what lives inside this node. Projects hold projects,
                pages hold pages, either holds either, any depth. */}
            {((selNode.children||[]).length>0)&&(
              <div style={{marginBottom:"24px"}}>
                <Eyebrow style={{marginBottom:"10px"}}>CONTENTS</Eyebrow>
                <div style={{background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"8px",overflow:"hidden"}}>
                  {(selNode.children||[]).map((c,i,arr)=>(
                    <div key={c.id} onClick={()=>setSel(c)}
                      style={{display:"flex",alignItems:"center",gap:"9px",padding:"9px 13px",cursor:"pointer",
                        borderBottom:i<arr.length-1?"1px solid var(--b)":"none"}} className="hr">
                      {c.type==="page"
                        ?<FileText size={13} color="var(--d)" strokeWidth={1.5}/>
                        :<LucideIcon name={catIconName(c.category,categories)} size={13} color={CAT_COLOR[c.category]||"var(--d)"}/>}
                      <span style={{fontSize:"12px",flex:1}}>{c.title}</span>
                      {(c.children||[]).length>0&&<span style={{fontSize:"9px",fontFamily:"var(--mono)",color:"var(--m)"}}>{c.children.length} inside</span>}
                      <button onClick={e=>{e.stopPropagation();if(confirm(`Delete "${c.title}" and everything inside it?`)) deleteChild(selNode.id,c.id)}}
                        style={{background:"none",border:"none",cursor:"pointer",color:"var(--m)",padding:"2px",display:"flex"}}><X size={11}/></button>
                      <ChevronRight size={12} color="var(--m)"/>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {sectionsOf(sel).includes("tasks")&&<>
            {/* Tasks */}
            <div style={{marginBottom:"24px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"10px",flexWrap:"wrap",gap:"8px"}}>
                <Eyebrow>TASKS</Eyebrow>
                <div style={{display:"flex",gap:"10px",alignItems:"center",flexWrap:"wrap"}}>
                  <div style={{display:"flex",gap:"4px"}}>
                    {["all","task","issue"].map(k=>(
                      <button key={k} onClick={()=>setTaskKindFilter(k)}
                        style={{fontSize:"9px",fontFamily:"var(--mono)",padding:"3px 8px",borderRadius:"999px",border:"1px solid",cursor:"pointer",
                          borderColor:taskKindFilter===k?"var(--amber)":"var(--b)",
                          background:taskKindFilter===k?"rgba(212,168,67,.1)":"transparent",
                          color:taskKindFilter===k?"var(--amber)":"var(--m)"}}>
                        {k==="all"?"all":k+"s"}
                      </button>
                    ))}
                  </div>
                  <div style={{display:"flex",gap:"2px",background:"var(--s2)",border:"1px solid var(--b)",borderRadius:"5px",padding:"2px"}}>
                    {[["list",List],["kanban",LayoutGrid],["timeline",BarChart3]].map(([v,Icon])=>(
                      <button key={v} onClick={()=>setTaskView(v)}
                        style={{display:"flex",alignItems:"center",gap:"4px",padding:"4px 8px",borderRadius:"4px",border:"none",cursor:"pointer",
                          background:taskView===v?"var(--s3)":"transparent",color:taskView===v?"var(--amber)":"var(--m)",fontSize:"9px",fontFamily:"var(--mono)"}}>
                        <Icon size={11} strokeWidth={1.5}/>{v}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* List view */}
              {taskView==="list"&&(
                <div style={{background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"8px",overflow:"hidden"}}>
                  {visibleTasks.length===0&&(
                    <div style={{padding:"14px",fontSize:"12px",color:"var(--m)",fontStyle:"italic"}}>
                      {taskKindFilter==="issue"?"No issues logged.":`No tasks. Try: "add task to ${sel.title}: your task"`}
                    </div>
                  )}
                  {visibleTasks.map((t,i)=>(
                    <div key={t.id} style={{display:"flex",alignItems:"center",gap:"9px",
                      padding:"8px 13px",borderBottom:i<visibleTasks.length-1?"1px solid var(--b)":"none"}} className="hr"
                      onDoubleClick={()=>setEditingTask(editingTask===t.id?null:t.id)}>
                      {editingTask===t.id?(
                        <div style={{display:"flex",flexWrap:"wrap",gap:"6px",alignItems:"center",width:"100%"}} onClick={e=>e.stopPropagation()}>
                          <input defaultValue={t.title} autoFocus placeholder="title"
                            onBlur={e=>updateTask(sel.id,t.id,{title:e.target.value})}
                            style={{flex:"1 1 130px",background:"var(--s3)",color:"var(--t)",border:"1px solid var(--amber)33",borderRadius:"4px",padding:"3px 7px",fontSize:"12px"}}/>
                          <select defaultValue={t.status} onBlur={e=>updateTask(sel.id,t.id,{status:e.target.value})}
                            style={{background:"var(--s3)",color:"var(--t)",border:"1px solid var(--b)",borderRadius:"4px",padding:"3px 6px",fontSize:"11px"}}>
                            {["Not started","In progress","Complete"].map(s=><option key={s}>{s}</option>)}
                          </select>
                          <select defaultValue={t.priority} title="priority" onBlur={e=>updateTask(sel.id,t.id,{priority:e.target.value})}
                            style={{background:"var(--s3)",color:priorityColor(t.priority),border:"1px solid var(--b)",borderRadius:"4px",padding:"3px 6px",fontSize:"11px"}}>
                            {["low","medium","high"].map(p=><option key={p} value={p}>{p}</option>)}
                          </select>
                          <select defaultValue={t.kind} title="kind" onBlur={e=>updateTask(sel.id,t.id,{kind:e.target.value})}
                            style={{background:"var(--s3)",color:"var(--t)",border:"1px solid var(--b)",borderRadius:"4px",padding:"3px 6px",fontSize:"11px"}}>
                            <option value="task">task</option><option value="issue">issue</option>
                          </select>
                          <label style={{display:"flex",alignItems:"center",gap:"3px",fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)",cursor:"pointer"}}>
                            <input type="checkbox" defaultChecked={t.milestone} onChange={e=>updateTask(sel.id,t.id,{milestone:e.target.checked})}/> milestone
                          </label>
                          <input type="date" defaultValue={t.start||""} title="start (optional — used by the timeline view)"
                            onBlur={e=>updateTask(sel.id,t.id,{start:e.target.value||null})}
                            style={{background:"var(--s3)",color:"var(--t)",border:"1px solid var(--b)",borderRadius:"4px",padding:"3px 6px",fontSize:"11px",colorScheme:"dark"}}/>
                          <input type="date" defaultValue={t.deadline||""} title="deadline"
                            onBlur={e=>updateTask(sel.id,t.id,{deadline:e.target.value||null})}
                            style={{background:"var(--s3)",color:"var(--t)",border:"1px solid var(--b)",borderRadius:"4px",padding:"3px 6px",fontSize:"11px",colorScheme:"dark"}}/>
                          <button onClick={()=>{deleteTask(sel.id,t.id);setEditingTask(null)}}
                            style={{background:"none",border:"none",cursor:"pointer",color:"var(--red)",padding:"2px"}}><X size={12}/></button>
                          <button onClick={()=>setEditingTask(null)}
                            style={{fontSize:"9px",fontFamily:"var(--mono)",color:"var(--d)",background:"none",border:"1px solid var(--b)",borderRadius:"4px",padding:"3px 7px",cursor:"pointer"}}>
                            done
                          </button>
                        </div>
                      ):(
                        <>
                          <Dot color={priorityColor(t.priority)} size={6}/>
                          {t.kind==="issue"?<Bug size={12} color="var(--d)" strokeWidth={1.5}/>:t.milestone?<Star size={12} color="var(--amber)" strokeWidth={1.5} fill="var(--amber)"/>:null}
                          <span style={{fontSize:"12px",flex:1}}>{t.title}</span>
                          {t.deadline&&<span style={{fontFamily:"var(--mono)",fontSize:"10px",color:"var(--amber)"}}>{t.deadline}</span>}
                          <Badge status={t.status}/>
                          <span style={{fontSize:"9px",color:"var(--m)",fontFamily:"var(--mono)"}}>dbl-click</span>
                        </>
                      )}
                    </div>
                  ))}
                  <div style={{padding:"7px 13px",borderTop:visibleTasks.length?"1px solid var(--b)":"none",display:"flex",gap:"12px"}}>
                    <button onClick={()=>addTask(sel.id,{})}
                      style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)",background:"none",border:"none",cursor:"pointer"}}>
                      + add task
                    </button>
                    <button onClick={()=>addTask(sel.id,{kind:"issue",title:"New issue"})}
                      style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)",background:"none",border:"none",cursor:"pointer"}}>
                      + add issue
                    </button>
                    <button onClick={()=>{setCmd(`add task to ${sel.title}: `);cmdRef.current?.focus()}}
                      style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--m)",background:"none",border:"none",cursor:"pointer",marginLeft:"auto"}}>
                      or via command bar
                    </button>
                  </div>
                </div>
              )}

              {/* Kanban view — native HTML5 drag and drop, no extra libraries */}
              {taskView==="kanban"&&(
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"10px"}}>
                  {["Not started","In progress","Complete"].map(col=>{
                    const colTasks=visibleTasks.filter(t=>t.status===col)
                    return (
                      <div key={col}
                        onDragOver={e=>e.preventDefault()}
                        onDrop={e=>{const id=e.dataTransfer.getData("text/plain");if(id) updateTask(sel.id,id,{status:col})}}
                        style={{background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"8px",minHeight:"120px",display:"flex",flexDirection:"column"}}>
                        <div style={{padding:"9px 11px",borderBottom:"1px solid var(--b)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <span style={{fontSize:"10px",fontFamily:"var(--mono)",color:STATUS_COLOR[col]||"var(--d)"}}>{col}</span>
                          <span style={{fontSize:"9px",fontFamily:"var(--mono)",color:"var(--m)"}}>{colTasks.length}</span>
                        </div>
                        <div style={{padding:"8px",display:"flex",flexDirection:"column",gap:"6px",flex:1}}>
                          {colTasks.map(t=>(
                            <div key={t.id} draggable
                              onDragStart={e=>e.dataTransfer.setData("text/plain",t.id)}
                              onDoubleClick={()=>{setTaskView("list");setEditingTask(t.id)}}
                              style={{background:"var(--s2)",border:"1px solid var(--b)",borderLeft:t.priority==="high"?`2px solid ${AMBER_HEX}`:"1px solid var(--b)",
                                borderRadius:"5px",padding:"8px 9px",cursor:"grab",fontSize:"11px"}}>
                              <div style={{display:"flex",alignItems:"center",gap:"5px",marginBottom:t.deadline?"4px":0}}>
                                {t.kind==="issue"?<Bug size={11} color="var(--d)" strokeWidth={1.5}/>:t.milestone?<Star size={11} color="var(--amber)" fill="var(--amber)" strokeWidth={1.5}/>:<GripVertical size={11} color="var(--m)"/>}
                                <span style={{flex:1}}>{t.title}</span>
                              </div>
                              {t.deadline&&<div style={{fontSize:"9px",fontFamily:"var(--mono)",color:"var(--amber)"}}>{t.deadline}</div>}
                            </div>
                          ))}
                          {colTasks.length===0&&<div style={{fontSize:"9px",fontFamily:"var(--mono)",color:"var(--m)",textAlign:"center",padding:"10px 0"}}>—</div>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Timeline / Gantt view */}
              {taskView==="timeline"&&<GanttView tasks={visibleTasks} projId={sel.id} updateTask={updateTask}/>}
            </div>

            </>}

            {sectionsOf(sel).includes("budget")&&<>
            {/* Budget & Expenses — every project gets this for free, but nothing
                forces its use. Expenses log independent of a budget; setting
                one additionally turns on the spend-vs-budget math. */}
            <div style={{marginBottom:"24px"}}>
              <Eyebrow style={{marginBottom:"10px"}}>BUDGET & EXPENSES</Eyebrow>

              <div style={{background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"8px",padding:"14px",marginBottom:"10px"}}>
                {bStats.hasBudget?(
                  <>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"7px"}}>
                      <div style={{display:"flex",alignItems:"baseline",gap:"5px"}}>
                        <span style={{fontFamily:"var(--mono)",fontSize:"13px",color:bStats.over?"var(--red)":"var(--t)"}}>£{bStats.spent.toFixed(2)}</span>
                        <span style={{fontSize:"11px",color:"var(--d)"}}>of</span>
                        <input type="number" step="1" defaultValue={bStats.budget}
                          onBlur={e=>setBudget(sel.id,Number(e.target.value)||0)}
                          style={{width:"66px",background:"var(--s3)",border:"1px solid var(--b)",borderRadius:"3px",color:"var(--t)",
                            fontFamily:"var(--mono)",fontSize:"12px",padding:"1px 5px"}}/>
                      </div>
                      <span style={{fontSize:"10px",fontFamily:"var(--mono)",color:bStats.over?"var(--red)":"var(--amber)"}}>
                        {bStats.pct}%{bStats.over?" over":""}
                      </span>
                    </div>
                    <div style={{height:"6px",background:"var(--s3)",borderRadius:"3px",overflow:"hidden"}}>
                      <div style={{height:"100%",width:Math.min(100,bStats.pct)+"%",
                        background:bStats.over?"var(--red)":"var(--amber)",transition:"width .2s"}}/>
                    </div>
                  </>
                ):(
                  <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                    <Wallet size={13} color="var(--m)" strokeWidth={1.5}/>
                    <span style={{fontSize:"11px",color:"var(--m)"}}>Total spent: £{bStats.spent.toFixed(2)}</span>
                    <input type="number" placeholder="set a budget"
                      onBlur={e=>{const v=Number(e.target.value)||0;if(v>0) setBudget(sel.id,v)}}
                      style={{width:"84px",background:"var(--s3)",border:"1px solid var(--b)",borderRadius:"3px",color:"var(--t)",
                        fontFamily:"var(--mono)",fontSize:"12px",padding:"2px 6px"}}/>
                    <span style={{fontSize:"10px",color:"var(--m)"}}>optional</span>
                  </div>
                )}
              </div>

              <div style={{background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"8px",overflow:"hidden"}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 90px 110px 22px",gap:"8px",padding:"7px 13px",
                  borderBottom:"1px solid var(--b)",fontSize:"9px",fontFamily:"var(--mono)",color:"var(--m)",letterSpacing:".06em"}}>
                  <span>EXPENSE</span><span>AMOUNT</span><span>DATE</span><span/>
                </div>
                {(sel.expenses||[]).map(exp=>(
                  <div key={exp.id} style={{display:"grid",gridTemplateColumns:"1fr 90px 110px 22px",gap:"8px",alignItems:"center",
                    padding:"6px 13px",borderBottom:"1px solid var(--b)"}} className="hr">
                    <input defaultValue={exp.label} placeholder="label, link, or note" onBlur={e=>updateExpense(sel.id,exp.id,{label:e.target.value})}
                      style={{background:"transparent",border:"none",color:"var(--t)",fontSize:"12px",outline:"none"}}/>
                    <input type="number" step="0.01" defaultValue={exp.amount}
                      onBlur={e=>updateExpense(sel.id,exp.id,{amount:Number(e.target.value)||0})}
                      style={{background:"transparent",border:"none",color:"var(--amber)",fontFamily:"var(--mono)",fontSize:"11px",outline:"none",width:"100%"}}/>
                    <input type="date" defaultValue={exp.date||""} onBlur={e=>updateExpense(sel.id,exp.id,{date:e.target.value||null})}
                      style={{background:"transparent",border:"none",color:"var(--d)",fontFamily:"var(--mono)",fontSize:"10px",outline:"none",colorScheme:"dark"}}/>
                    <button onClick={()=>deleteExpense(sel.id,exp.id)} style={{background:"none",border:"none",cursor:"pointer",color:"var(--m)",padding:0}}><X size={11}/></button>
                  </div>
                ))}
                <div style={{padding:"7px 13px"}}>
                  <button onClick={()=>addExpense(sel.id,{id:"e_"+Date.now(),label:"New expense",amount:0,date:ymd(new Date())})}
                    style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)",background:"none",border:"none",cursor:"pointer"}}>
                    + add expense
                  </button>
                </div>
              </div>
            </div>
            </>}

            {sectionsOf(sel).includes("resources")&&<>
            <div style={{marginBottom:"24px"}}>
              <Eyebrow style={{marginBottom:"10px"}}>PEOPLE & RESOURCES</Eyebrow>
              <div style={{background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"8px",overflow:"hidden"}}>
                {(sel.resources||[]).length===0?(
                  <button onClick={()=>addResource(sel.id,{id:"r_"+Date.now(),name:"",role:""})}
                    style={{fontSize:"11px",fontFamily:"var(--mono)",color:"var(--m)",background:"none",border:"none",
                      padding:"12px",width:"100%",cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:"6px"}}>
                    <Users size={12} strokeWidth={1.5}/> + add a resource (person / equipment)
                  </button>
                ):(
                  <>
                    {sel.resources.map(r=>(
                      <div key={r.id} style={{display:"flex",alignItems:"center",gap:"8px",padding:"7px 13px",borderBottom:"1px solid var(--b)"}} className="hr">
                        <Users size={12} color="var(--d)" strokeWidth={1.5}/>
                        <input defaultValue={r.name} placeholder="name" onBlur={e=>updateResource(sel.id,r.id,{name:e.target.value})}
                          style={{background:"transparent",border:"none",color:"var(--t)",fontSize:"12px",outline:"none",flex:1}}/>
                        <input defaultValue={r.role} placeholder="role" onBlur={e=>updateResource(sel.id,r.id,{role:e.target.value})}
                          style={{background:"transparent",border:"none",color:"var(--d)",fontFamily:"var(--mono)",fontSize:"10px",outline:"none",width:"110px"}}/>
                        <button onClick={()=>deleteResource(sel.id,r.id)} style={{background:"none",border:"none",cursor:"pointer",color:"var(--m)",padding:0}}><X size={11}/></button>
                      </div>
                    ))}
                    <button onClick={()=>addResource(sel.id,{id:"r_"+Date.now(),name:"",role:""})}
                      style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)",background:"none",border:"none",padding:"7px 13px",cursor:"pointer"}}>
                      + add resource
                    </button>
                  </>
                )}
              </div>
            </div>
            </>}

            {sectionsOf(sel).includes("links")&&<>
            <div style={{marginBottom:"24px"}}>
              <Eyebrow style={{marginBottom:"10px"}}>LINKS</Eyebrow>
              <div style={{background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"8px",overflow:"hidden"}}>
                {(sel.links||[]).map((lk,i,arr)=>(
                  <div key={lk.id} style={{display:"flex",alignItems:"center",gap:"8px",padding:"7px 13px",borderBottom:i<arr.length-1?"1px solid var(--b)":"none"}} className="hr">
                    <Link2 size={12} color="var(--d)" strokeWidth={1.5}/>
                    <input defaultValue={lk.label} placeholder="label" onBlur={e=>updateLink(sel.id,lk.id,{label:e.target.value})}
                      style={{background:"transparent",border:"none",color:"var(--t)",fontSize:"12px",outline:"none",width:"160px",flexShrink:0}}/>
                    <input defaultValue={lk.url} placeholder="https://…" onBlur={e=>updateLink(sel.id,lk.id,{url:e.target.value})}
                      style={{background:"transparent",border:"none",color:"var(--d)",fontFamily:"var(--mono)",fontSize:"11px",outline:"none",flex:1}}/>
                    {lk.url&&<a href={lk.url} target="_blank" rel="noreferrer" style={{color:"var(--teal)",display:"flex"}}><ExternalLink size={11}/></a>}
                    <button onClick={()=>deleteLink(sel.id,lk.id)} style={{background:"none",border:"none",cursor:"pointer",color:"var(--m)",padding:0}}><X size={11}/></button>
                  </div>
                ))}
                <div style={{padding:"9px 13px"}}>
                  {(sel.links||[]).length===0&&(
                    <div style={{display:"flex",flexWrap:"wrap",gap:"5px",marginBottom:"8px"}}>
                      {LINK_SUGGESTIONS.map(s=>(
                        <button key={s} onClick={()=>addLink(sel.id,{id:"lk_"+Date.now(),label:s,url:""})}
                          style={{fontSize:"9px",fontFamily:"var(--mono)",color:"var(--m)",background:"var(--s2)",border:"1px solid var(--b)",
                            borderRadius:"999px",padding:"3px 8px",cursor:"pointer"}}>
                          + {s}
                        </button>
                      ))}
                    </div>
                  )}
                  <button onClick={()=>addLink(sel.id,{id:"lk_"+Date.now(),label:"New link",url:""})}
                    style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)",background:"none",border:"none",cursor:"pointer"}}>
                    + add link
                  </button>
                </div>
              </div>
            </div>
            </>}

            {sectionsOf(sel).includes("notes")&&<>
            <div style={{marginBottom:"24px"}}>
              <Eyebrow style={{marginBottom:"10px"}}>NOTES</Eyebrow>
              <textarea defaultValue={sel.notes||""} placeholder="Freeform notes for this project…"
                onBlur={e=>updateNotes(sel.id,e.target.value)}
                style={{width:"100%",minHeight:"110px",background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"8px",
                  color:"var(--t)",fontSize:"13px",fontFamily:"var(--sans)",padding:"12px 13px",resize:"vertical",lineHeight:"1.6"}}/>
            </div>
            </>}

            {sectionsOf(sel).includes("tables")&&<>
            <div style={{marginBottom:"24px"}}>
              <Eyebrow style={{marginBottom:"10px"}}>TABLES</Eyebrow>
              {(sel.tables||[]).map(tb=>(
                <div key={tb.id} style={{background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"8px",overflow:"hidden",marginBottom:"10px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:"8px",padding:"8px 12px",borderBottom:"1px solid var(--b)"}}>
                    <input defaultValue={tb.title} onBlur={e=>updateTable(sel.id,tb.id,t=>({...t,title:e.target.value}))}
                      style={{background:"transparent",border:"none",color:"var(--t)",fontSize:"12px",fontWeight:"500",outline:"none",flex:1}}/>
                    <button onClick={()=>updateTable(sel.id,tb.id,t=>({...t,cols:[...t.cols,`Column ${t.cols.length+1}`],rows:t.rows.map(r=>[...r,""])}))}
                      style={{fontSize:"9px",fontFamily:"var(--mono)",color:"var(--d)",background:"none",border:"none",cursor:"pointer"}}>+ col</button>
                    <button onClick={()=>{if(confirm(`Delete table "${tb.title}"?`)) deleteTable(sel.id,tb.id)}}
                      style={{background:"none",border:"none",cursor:"pointer",color:"var(--m)",padding:0,display:"flex"}}><X size={11}/></button>
                  </div>
                  <div style={{overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse"}}>
                      <thead><tr>
                        {tb.cols.map((c,ci)=>(
                          <th key={ci} style={{borderBottom:"1px solid var(--b)",borderRight:ci<tb.cols.length-1?"1px solid var(--b)":"none",padding:0}}>
                            <input defaultValue={c} onBlur={e=>updateTable(sel.id,tb.id,t=>({...t,cols:t.cols.map((x,i)=>i===ci?e.target.value:x)}))}
                              style={{width:"100%",background:"var(--s2)",border:"none",color:"var(--d)",fontSize:"9px",fontFamily:"var(--mono)",
                                letterSpacing:".06em",padding:"6px 10px",outline:"none",textAlign:"left",minWidth:"90px"}}/>
                          </th>
                        ))}
                        <th style={{width:"26px",borderBottom:"1px solid var(--b)"}}/>
                      </tr></thead>
                      <tbody>
                        {tb.rows.map((row,ri)=>(
                          <tr key={ri}>
                            {row.map((cell,ci)=>(
                              <td key={ci} style={{borderBottom:ri<tb.rows.length-1?"1px solid var(--b)":"none",borderRight:ci<tb.cols.length-1?"1px solid var(--b)":"none",padding:0}}>
                                <input defaultValue={cell} onBlur={e=>updateTable(sel.id,tb.id,t=>({...t,rows:t.rows.map((r,i)=>i===ri?r.map((x,j)=>j===ci?e.target.value:x):r)}))}
                                  style={{width:"100%",background:"transparent",border:"none",color:"var(--t)",fontSize:"11px",padding:"6px 10px",outline:"none",minWidth:"90px"}}/>
                              </td>
                            ))}
                            <td style={{borderBottom:ri<tb.rows.length-1?"1px solid var(--b)":"none",textAlign:"center"}}>
                              <button onClick={()=>updateTable(sel.id,tb.id,t=>({...t,rows:t.rows.filter((_,i)=>i!==ri)}))}
                                style={{background:"none",border:"none",cursor:"pointer",color:"var(--m)",padding:"2px",display:"inline-flex"}}><X size={10}/></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button onClick={()=>updateTable(sel.id,tb.id,t=>({...t,rows:[...t.rows,t.cols.map(()=>"")]}))}
                    style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)",background:"none",border:"none",cursor:"pointer",padding:"7px 12px"}}>
                    + row
                  </button>
                </div>
              ))}
              <button onClick={()=>addTable(sel.id)}
                style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--m)",background:"var(--s1)",border:"1px dashed var(--b)",
                  borderRadius:"8px",padding:"9px",cursor:"pointer",width:"100%"}}>
                + add table
              </button>
            </div>
            </>}

            {sectionsOf(sel).includes("charts")&&<>
            <div style={{marginBottom:"24px"}}>
              <Eyebrow style={{marginBottom:"10px"}}>CHARTS</Eyebrow>
              {(sel.charts||[]).map(ch=>{
                const tb=(sel.tables||[]).find(t=>t.id===ch.tableId)
                const labelIdx=tb?tb.cols.indexOf(ch.labelCol):-1
                const valueIdx=tb?tb.cols.indexOf(ch.valueCol):-1
                const rows=(tb&&labelIdx>=0&&valueIdx>=0)?tb.rows.map(r=>({label:r[labelIdx]||"—",value:Number(r[valueIdx])||0})):[]
                const max=Math.max(1,...rows.map(r=>r.value))
                return(
                  <div key={ch.id} style={{background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"8px",padding:"12px 14px",marginBottom:"10px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"10px"}}>
                      <input defaultValue={ch.title} onBlur={e=>updateChart(sel.id,ch.id,{title:e.target.value})}
                        style={{background:"transparent",border:"none",color:"var(--t)",fontSize:"12px",fontWeight:"500",outline:"none",flex:1}}/>
                      <select value={ch.tableId||""} onChange={e=>updateChart(sel.id,ch.id,{tableId:e.target.value})}
                        style={{background:"var(--s3)",color:"var(--d)",border:"1px solid var(--b)",borderRadius:"4px",padding:"2px 5px",fontSize:"10px"}}>
                        <option value="">table…</option>
                        {(sel.tables||[]).map(t=><option key={t.id} value={t.id}>{t.title}</option>)}
                      </select>
                      {tb&&<>
                        <select value={ch.labelCol||""} onChange={e=>updateChart(sel.id,ch.id,{labelCol:e.target.value})}
                          style={{background:"var(--s3)",color:"var(--d)",border:"1px solid var(--b)",borderRadius:"4px",padding:"2px 5px",fontSize:"10px"}}>
                          <option value="">label…</option>{tb.cols.map(c=><option key={c}>{c}</option>)}
                        </select>
                        <select value={ch.valueCol||""} onChange={e=>updateChart(sel.id,ch.id,{valueCol:e.target.value})}
                          style={{background:"var(--s3)",color:"var(--d)",border:"1px solid var(--b)",borderRadius:"4px",padding:"2px 5px",fontSize:"10px"}}>
                          <option value="">value…</option>{tb.cols.map(c=><option key={c}>{c}</option>)}
                        </select>
                      </>}
                      <button onClick={()=>deleteChart(sel.id,ch.id)} style={{background:"none",border:"none",cursor:"pointer",color:"var(--m)",padding:0,display:"flex"}}><X size={11}/></button>
                    </div>
                    {rows.length?rows.map((r,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"4px"}}>
                        <span style={{width:"110px",fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)",flexShrink:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.label}</span>
                        <div style={{flex:1,height:"12px",background:"var(--s3)",borderRadius:"3px",overflow:"hidden"}}>
                          <div style={{height:"100%",width:(r.value/max*100)+"%",background:"var(--amber)",opacity:.35+.65*(r.value/max),transition:"width .2s"}}/>
                        </div>
                        <span style={{width:"58px",fontSize:"10px",fontFamily:"var(--mono)",textAlign:"right",flexShrink:0}}>{r.value}</span>
                      </div>
                    )):(
                      <div style={{fontSize:"10px",color:"var(--m)",fontStyle:"italic"}}>
                        {(sel.tables||[]).length?"Pick a table, a label column, and a numeric value column above.":"Add a table first — charts read straight from table data."}
                      </div>
                    )}
                  </div>
                )
              })}
              <button onClick={()=>addChart(sel.id,{id:"ch_"+Date.now(),title:"New chart",tableId:(sel.tables||[])[0]?.id||"",labelCol:(sel.tables||[])[0]?.cols[0]||"",valueCol:(sel.tables||[])[0]?.cols[1]||""})}
                style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--m)",background:"var(--s1)",border:"1px dashed var(--b)",
                  borderRadius:"8px",padding:"9px",cursor:"pointer",width:"100%"}}>
                + add chart
              </button>
            </div>
            </>}

            {sectionsOf(sel).includes("files")&&<>

            {/* Files */}
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"10px"}}>
                <Eyebrow>FILES & POINTERS</Eyebrow>
                <button onClick={()=>setAddFileFor(sel.id)}
                  style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)",background:"var(--s2)",
                    border:"1px solid var(--b)",borderRadius:"4px",padding:"3px 8px",cursor:"pointer"}}>
                  + add pointer
                </button>
              </div>
              <div style={{background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"8px",overflow:"hidden"}}>
                {files.filter(f=>f.projectId===sel.id).length===0&&(
                  <div style={{padding:"14px",fontSize:"12px",color:"var(--m)",fontStyle:"italic"}}>
                    No files tracked. Point to any file on any of your devices.
                  </div>
                )}
                {files.filter(f=>f.projectId===sel.id).map((f,i,arr)=>{
                  const canOpen=f.device==="cloud"||f.device===device
                  return(
                    <div key={f.id} style={{display:"grid",gridTemplateColumns:"22px 1fr 22px auto",gap:"10px",alignItems:"center",
                      padding:"9px 13px",borderBottom:i<arr.length-1?"1px solid var(--b)":"none"}} className="hr">
                      <span style={{fontSize:"13px"}}>{FILE_ICONS[f.type]||"📦"}</span>
                      <div>
                        <div style={{fontSize:"13px"}}>{f.name}</div>
                        <div style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)",marginTop:"1px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"280px"}}>{f.path}</div>
                      </div>
                      <span title={f.device}>{DEVICE_ICONS[f.device]||"?"}</span>
                      {canOpen
                        ?<a href={f.device==="cloud"?f.path:"#"} target="_blank" rel="noreferrer"
                          style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--teal)",textDecoration:"none",border:"1px solid var(--teal)33",borderRadius:"3px",padding:"2px 6px"}}>open ↗</a>
                        :<span style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--m)"}}>on {f.device}</span>
                      }
                    </div>
                  )
                })}
              </div>
            </div>
            </>}

            {/* Section manager — add what's missing, remove what isn't in
                use. Removing never deletes data, only hides it, so this is
                always a safe, undoable thing to click. */}
            <div style={{display:"flex",flexWrap:"wrap",gap:"6px",marginTop:"4px"}}>
              <button onClick={()=>addChild(sel.id,"project")}
                style={{display:"flex",alignItems:"center",gap:"5px",fontSize:"10px",fontFamily:"var(--mono)",color:"var(--amber)",
                  background:"rgba(212,168,67,.07)",border:"1px dashed rgba(212,168,67,.4)",borderRadius:"999px",padding:"5px 10px",cursor:"pointer"}}>
                <Layers size={11} strokeWidth={1.5}/> + sub-project
              </button>
              <button onClick={()=>addChild(sel.id,"page")}
                style={{display:"flex",alignItems:"center",gap:"5px",fontSize:"10px",fontFamily:"var(--mono)",color:"var(--amber)",
                  background:"rgba(212,168,67,.07)",border:"1px dashed rgba(212,168,67,.4)",borderRadius:"999px",padding:"5px 10px",cursor:"pointer"}}>
                <FileText size={11} strokeWidth={1.5}/> + page
              </button>
              {Object.entries(SECTION_DEFS).filter(([k])=>!sectionsOf(sel).includes(k)).map(([k,def])=>(
                <button key={k} onClick={()=>addSection(sel.id,k)}
                  style={{display:"flex",alignItems:"center",gap:"5px",fontSize:"10px",fontFamily:"var(--mono)",color:"var(--m)",
                    background:"var(--s2)",border:"1px dashed var(--b)",borderRadius:"999px",padding:"5px 10px",cursor:"pointer"}}>
                  <def.Icon size={11} strokeWidth={1.5}/> + {def.label}
                </button>
              ))}
              {sectionsOf(sel).length>0&&(
                <div style={{position:"relative"}} className="section-remove-wrap">
                  <details>
                    <summary style={{display:"flex",alignItems:"center",gap:"4px",fontSize:"9px",fontFamily:"var(--mono)",color:"var(--m)",
                      cursor:"pointer",listStyle:"none",padding:"5px 4px"}}>remove a section</summary>
                    <div style={{display:"flex",flexWrap:"wrap",gap:"6px",marginTop:"6px"}}>
                      {sectionsOf(sel).map(k=>(
                        <button key={k} onClick={()=>removeSection(sel.id,k)}
                          style={{fontSize:"9px",fontFamily:"var(--mono)",color:"var(--m)",background:"none",
                            border:"1px solid var(--b)",borderRadius:"999px",padding:"4px 8px",cursor:"pointer"}}>
                          {SECTION_DEFS[k]?.label||k} ×
                        </button>
                      ))}
                    </div>
                  </details>
                </div>
              )}
            </div>

            {/* Revision history — only shown when there's something to show.
                Each entry is the state BEFORE Notion's version won, so if a
                pull clobbers something you cared about, it's one click back. */}
            {(()=>{
              const revs = loadRevisions(sel.id)
              if(!revs.length) return null
              return(
                <details style={{marginTop:"8px"}}>
                  <summary style={{fontSize:"9px",fontFamily:"var(--mono)",color:"var(--m)",cursor:"pointer",listStyle:"none",padding:"4px 0"}}>
                    revision history ({revs.length})
                  </summary>
                  <div style={{display:"flex",flexDirection:"column",gap:"4px",marginTop:"6px"}}>
                    {revs.map((rev,i)=>(
                      <div key={i} style={{background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"6px",padding:"8px 10px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <span style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)"}}>{new Date(rev.saved_at).toLocaleString("en-GB",{dateStyle:"short",timeStyle:"short"})}</span>
                        <button onClick={()=>{
                          if(confirm("Restore this version? Current title and notes will be replaced."))
                            updateNode(sel.id,n=>({...n,title:rev.title||n.title,notes:rev.notes||n.notes,tables:rev.tables||n.tables}))
                        }} style={{fontSize:"9px",fontFamily:"var(--mono)",color:"var(--d)",background:"var(--s2)",border:"1px solid var(--b)",borderRadius:"4px",padding:"3px 8px",cursor:"pointer"}}>
                          restore
                        </button>
                      </div>
                    ))}
                  </div>
                </details>
              )
            })()}
          </div>
          )
        })():(
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",color:"var(--m)",fontSize:"12px",fontFamily:"var(--mono)"}}>
            SELECT A PROJECT
          </div>
        )}
      </div>
    )
  }

  function Files(){
    const [devF,setDevF]=useState("all")
    const [typeF,setTypeF]=useState("all")
    const filtered=files.filter(f=>(devF==="all"||f.device===devF)&&(typeF==="all"||f.type===typeF))

    return(
      <div style={{padding:"24px 28px",height:"100%",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"20px"}}>
          <div>
            <Eyebrow style={{marginBottom:"4px"}}>FILE POINTERS</Eyebrow>
            <div style={{fontSize:"12px",color:"var(--d)"}}>
              Files live on your devices. These are references, not copies.
            </div>
          </div>
          <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
            <span style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)"}}>i'm on:</span>
            <select value={device} onChange={e=>{setDevice(e.target.value);save({device:e.target.value})}}
              style={{background:"var(--s2)",color:"var(--t)",border:"1px solid var(--b)",borderRadius:"5px",padding:"5px 8px",fontSize:"12px"}}>
              {Object.keys(DEVICE_ICONS).map(d=><option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>

        <div style={{display:"flex",gap:"6px",marginBottom:"14px",flexWrap:"wrap"}}>
          {["all",...Object.keys(DEVICE_ICONS)].map(d=>(
            <button key={"d"+d} onClick={()=>setDevF(d)}
              style={{fontSize:"10px",fontFamily:"var(--mono)",padding:"4px 10px",borderRadius:"999px",border:"1px solid",cursor:"pointer",
                borderColor:devF===d?"var(--amber)":"var(--b)",
                background:devF===d?"rgba(212,168,67,.1)":"transparent",
                color:devF===d?"var(--amber)":"var(--d)",
                display:"flex",alignItems:"center",gap:"4px"}}>
              {d!=="all"&&<span style={{display:"flex",alignItems:"center"}}>{DEVICE_ICONS[d]}</span>}
              {d==="all"?"all devices":d}
            </button>
          ))}
          <div style={{width:"1px",background:"var(--b)",margin:"0 4px"}}/>
          {["all",...Object.keys(FILE_ICONS)].map(t=>(
            <button key={"t"+t} onClick={()=>setTypeF(t)}
              style={{fontSize:"10px",fontFamily:"var(--mono)",padding:"4px 10px",borderRadius:"999px",border:"1px solid",cursor:"pointer",
                borderColor:typeF===t?"var(--d)":"var(--b)",
                background:typeF===t?"var(--s2)":"transparent",
                color:"var(--d)",display:"flex",alignItems:"center",gap:"4px"}}>
              {t!=="all"&&<span style={{display:"flex",alignItems:"center"}}>{FILE_ICONS[t]}</span>}
              {t==="all"?"all types":t}
            </button>
          ))}
        </div>

        {filtered.length===0?(
          <div style={{background:"var(--s1)",border:"1px dashed var(--b)",borderRadius:"8px",padding:"40px",textAlign:"center",color:"var(--m)",fontSize:"12px",fontFamily:"var(--mono)"}}>
            {files.length===0
              ?"No file pointers yet. Try: \"add audio file vocals.wav on my phone to Blacksand\""
              :"No files match those filters."}
          </div>
        ):(
          <div style={{background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"8px",overflow:"hidden"}}>
            <div style={{display:"grid",gridTemplateColumns:"22px 1fr 110px 90px 70px",gap:"10px",padding:"7px 13px",
              borderBottom:"1px solid var(--b)",fontSize:"10px",fontFamily:"var(--mono)",color:"var(--m)",letterSpacing:".06em"}}>
              <span/><span>NAME</span><span>PROJECT</span><span>DEVICE</span><span/>
            </div>
            {filtered.map((f,i)=>{
              const proj=projects.find(p=>p.id===f.projectId)
              const canOpen=f.device==="cloud"||f.device===device
              const isFolder=f.type==="folder"
              return(
                <div key={f.id} style={{display:"grid",gridTemplateColumns:"22px 1fr 110px 90px 60px",gap:"10px",
                  alignItems:"center",padding:"9px 13px",borderBottom:i<filtered.length-1?"1px solid var(--b)":"none"}} className="hr">
                  <span style={{display:"flex",alignItems:"center",color:isFolder?"var(--amber)":"var(--d)"}}>
                    {FILE_ICONS[f.type]||<File size={13}/>}
                  </span>
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:"12px",display:"flex",alignItems:"center",gap:"6px",overflow:"hidden"}}>
                      <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.name}</span>
                      {isFolder&&<span style={{fontSize:"9px",fontFamily:"var(--mono)",color:"var(--amber)",background:"rgba(212,168,67,.1)",padding:"1px 5px",borderRadius:"3px",flexShrink:0}}>folder</span>}
                    </div>
                    <div style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)",marginTop:"2px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.path}</div>
                    {isFolder&&f.childCount>0&&<div style={{fontSize:"9px",fontFamily:"var(--mono)",color:"var(--m)",marginTop:"1px"}}>{f.childCount} items tracked inside</div>}
                  </div>
                  <div style={{fontSize:"11px",color:"var(--d)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{proj?proj.title:"—"}</div>
                  <div style={{fontSize:"11px",color:"var(--d)",display:"flex",alignItems:"center",gap:"4px"}}>
                    <span style={{color:"var(--m)"}}>{DEVICE_ICONS[f.device]}</span>
                    <span>{f.device}</span>
                  </div>
                  <div style={{display:"flex",justifyContent:"flex-end"}}>
                    {canOpen
                      ?<button onClick={()=>{
                          if(f.device==="cloud"){ window.open(f.path,"_blank") }
                          else{ navigator.clipboard?.writeText(f.path).then(()=>flash("Path copied: "+f.path,"ok")).catch(()=>flash("Path: "+f.path,"ok")) }
                        }}
                        style={{display:"flex",alignItems:"center",gap:"3px",fontSize:"10px",color:"var(--teal)",fontFamily:"var(--mono)",background:"none",border:"none",cursor:"pointer",padding:0}}>
                        <ExternalLink size={10}/>{f.device==="cloud"?"open":"copy path"}
                      </button>
                      :<span style={{fontSize:"9px",color:"var(--m)",fontFamily:"var(--mono)"}}>{f.device}</span>
                    }
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // ── Notion Calendar Events DB ─────────────────────────────────────────
  const NOTION_CAL_DB = "9584ce32299b4bcbaeec44d290e4b32b"
  const NOTION_CAL_URL = "https://app.notion.com/p/9584ce32299b4bcbaeec44d290e4b32b"

  async function notionCalQuery(start, end) {
    if (!apiBase || !creds.some(c=>c.service==="notion")) return []
    const r = await backendFetch(`/proxy/notion/v1/databases/${NOTION_CAL_DB}/query`, {
      method: "POST",
      body: JSON.stringify({
        filter: { and: [
          { property: "Date", date: { on_or_after: start } },
          { property: "Date", date: { on_or_before: end } },
          { property: "Done", checkbox: { equals: false } }
        ]},
        sorts: [{ property: "Date", direction: "ascending" }]
      })
    })
    if (!r.ok) throw new Error(`Notion ${r.status}`)
    const d = await r.json()
    return (d.results || []).map(p => {
      const props = p.properties || {}
      const dateStart = props.Date?.date?.start || ""
      const dateEnd = props.Date?.date?.end || ""
      const [date, time] = dateStart.includes("T") ? dateStart.split("T") : [dateStart, null]
      // Notion's Date property natively supports a range (dragging an
      // event's duration in Notion's own calendar view sets exactly this
      // "end" field) — read it if it's there, so duration data comes from
      // something real rather than an invented separate property.
      const endTime = dateEnd.includes("T") ? dateEnd.split("T")[1].slice(0,5) : null
      const type = props.Type?.select?.name || "Event"
      // Notion returns each option's own colour name right on the value —
      // reading it straight from here guarantees a match with what Notion
      // itself would show, rather than keeping a second, driftable copy.
      const color = NOTION_COLOR_HEX[props.Type?.select?.color] || "var(--d)"
      return {
        id: p.id, notion_url: p.url,
        title: props.Name?.title?.[0]?.text?.content || "Untitled",
        date, time: time ? time.slice(0,5) : null, endTime, type, color,
        module: props.Module?.rich_text?.[0]?.text?.content || "",
        room: props.Room?.rich_text?.[0]?.text?.content || "",
        source: "notion"
      }
    })
  }

  async function notionCalCreate(event) {
    if (!apiBase || !creds.some(c=>c.service==="notion")) throw new Error("Connect Notion in Settings first.")
    const dateStr = event.time ? `${event.date}T${event.time}:00` : event.date
    const endStr = event.endTime && event.time ? `${event.date}T${event.endTime}:00` : undefined
    const body = {
      parent: { database_id: NOTION_CAL_DB },
      properties: {
        Name: { title: [{ text: { content: event.title } }] },
        Date: { date: { start: dateStr, end: endStr, is_datetime: !!event.time } },
        Type: { select: { name: event.type || "Event" } },
        ...(event.module && { Module: { rich_text: [{ text: { content: event.module } }] } }),
        ...(event.room && { Room: { rich_text: [{ text: { content: event.room } }] } }),
        ...(event.notes && { Notes: { rich_text: [{ text: { content: event.notes } }] } }),
      }
    }
    const r = await backendFetch(`/proxy/notion/v1/pages`, {
      method: "POST",
      body: JSON.stringify(body)
    })
    if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e?.message || `Notion ${r.status}`) }
    return r.json()
  }

  // ── Event types — read straight from Notion's own schema, not a separate
  // LifeOS-side guess, so colours are guaranteed to match what you'd see on
  // the real Notion Calendar (this IS the source Notion itself uses).
  async function fetchNotionEventTypes() {
    if (!apiBase || !creds.some(c=>c.service==="notion")) return null
    try {
      const r = await backendFetch(`/proxy/notion/v1/databases/${NOTION_CAL_DB}`)
      if (!r.ok) return null
      const d = await r.json()
      const options = d.properties?.Type?.select?.options || []
      if (!options.length) return null
      return options.map(o => ({ name:o.name, color:o.color, hex:NOTION_COLOR_HEX[o.color]||"#7F7F7F" }))
    } catch { return null }
  }

  async function createNotionEventType(name, colorName) {
    if (!apiBase || !creds.some(c=>c.service==="notion")) throw new Error("Connect Notion in Settings first.")
    const current = (await fetchNotionEventTypes()) || eventTypes
    if (current.some(t=>t.name.toLowerCase()===name.toLowerCase())) return current
    const nextOptions = [...current.map(t=>({name:t.name,color:t.color})), {name, color:colorName}]
    const r = await backendFetch(`/proxy/notion/v1/databases/${NOTION_CAL_DB}`, {
      method:"PATCH",
      body: JSON.stringify({ properties: { Type: { select: { options: nextOptions } } } })
    })
    if (!r.ok) { const e=await r.json().catch(()=>({})); throw new Error(e?.message||`Notion ${r.status}`) }
    const updated = [...current, {name, color:colorName, hex:NOTION_COLOR_HEX[colorName]}]
    setEventTypes(updated)
    return updated
  }

  // ── Calendar view ────────────────────────────────────────────────────
  function CalendarView(){
    const [wOff,setWOff]=useState(0)
    const [notionEvents,setNotionEvents]=useState([])
    const [loading,setLoading]=useState(false)
    const [err,setErr]=useState("")
    const [addOpen,setAddOpen]=useState(false)
    const [addForm,setAddForm]=useState({title:"",date:"",time:"",endTime:"",type:"Event",module:"",room:"",notes:""})
    const [adding,setAdding]=useState(false)
    const [addMsg,setAddMsg]=useState("")
    const [addingType,setAddingType]=useState(false)
    const [newTypeName,setNewTypeName]=useState("")
    const [newTypeColor,setNewTypeColor]=useState("blue")


    const weekStart=getMon(addD(new Date(),wOff*7))
    const days=[...Array(7)].map((_,i)=>addD(weekStart,i))
    const todayStr=ymd(new Date())
    const DAY_SHORT=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]

    // Resolve recurring timetable sessions for this week from localStorage
    const timetableSessions = (() => {
      try {
        return JSON.parse(localStorage.getItem("lifeos_timetable")||"[]")
          .filter(s=>s.source==="timetable"&&s.day&&s.time&&s.termStart)
          .map(s=>{
            const termMon=new Date(s.termStart+"T00:00:00")
            const matchedDay=days.find(d=>DAY_SHORT[d.getDay()]===s.day||d.toLocaleDateString("en-US",{weekday:"short"})===s.day)
            if(!matchedDay) return null
            const diffDays=Math.round((matchedDay-termMon)/86400000)
            if(diffDays<0) return null
            const weekNum=Math.floor(diffDays/7)+1
            if(!parseWeeksStr(s.weeks).includes(weekNum)) return null
            return{...s, date:ymd(matchedDay), color:"var(--teal)"}
          }).filter(Boolean)
      } catch{ return [] }
    })()

    // Fetch Notion events for this week
    useEffect(()=>{
      if(!apiBase || !creds.some(c=>c.service==="notion")){setNotionEvents([]);return}
      setLoading(true);setErr("")
      const start=ymd(weekStart),end=ymd(addD(weekStart,8))
      notionCalQuery(start,end).then(setNotionEvents).catch(e=>setErr(e.message)).finally(()=>setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
    },[wOff,apiBase,creds])

    const allEvents=[...timetableSessions,...notionEvents]
    const fmt=d=>d.toLocaleDateString("en-GB",{day:"numeric",month:"short"})

    async function submitAdd(e){
      e.preventDefault()
      if(!addForm.title||!addForm.date){setAddMsg("Title and date are required.");return}
      setAdding(true);setAddMsg("")
      try{
        await notionCalCreate(addForm)
        setAddMsg("Added to Notion Calendar ✓")
        setAddForm({title:"",date:"",time:"",endTime:"",type:"Event",module:"",room:"",notes:""})
        // Refresh
        const start=ymd(weekStart),end=ymd(addD(weekStart,8))
        notionCalQuery(start,end).then(setNotionEvents).catch(()=>{})
        setTimeout(()=>setAddOpen(false),1200)
      }catch(er){setAddMsg("Error: "+er.message)}
      finally{setAdding(false)}
    }

    return(
      <div style={{padding:"16px 20px",height:"100%",display:"flex",flexDirection:"column",gap:"12px",overflowY:"auto"}}>
        {/* Header row */}
        <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
          <button onClick={()=>setWOff(w=>w-1)} style={{background:"var(--s2)",border:"1px solid var(--b)",color:"var(--d)",borderRadius:"5px",padding:"5px 10px",cursor:"pointer",fontSize:"12px"}}>←</button>
          <div style={{flex:1,textAlign:"center"}}>
            <div style={{fontSize:"12px",fontWeight:"500"}}>{fmt(weekStart)} — {fmt(days[6])}</div>
            <Eyebrow style={{marginTop:"2px"}}>{wOff===0?"THIS WEEK":wOff<0?Math.abs(wOff)+" WEEK(S) AGO":wOff+" WEEK(S) AHEAD"}</Eyebrow>
          </div>
          <button onClick={()=>setWOff(0)} style={{background:"transparent",border:"1px solid var(--b)",color:"var(--d)",borderRadius:"5px",padding:"5px 9px",cursor:"pointer",fontSize:"10px",fontFamily:"var(--mono)"}}>now</button>
          <button onClick={()=>setWOff(w=>w+1)} style={{background:"var(--s2)",border:"1px solid var(--b)",color:"var(--d)",borderRadius:"5px",padding:"5px 10px",cursor:"pointer",fontSize:"12px"}}>→</button>
          <button onClick={()=>setAddOpen(true)} style={{background:"var(--amber)",color:"#000",border:"none",borderRadius:"5px",padding:"6px 12px",cursor:"pointer",fontSize:"11px",fontWeight:"600",fontFamily:"var(--mono)"}}>+ event</button>
          <a href={NOTION_CAL_URL} target="_blank" rel="noreferrer" style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)",textDecoration:"none",border:"1px solid var(--b)",borderRadius:"4px",padding:"5px 9px"}}>notion ↗</a>
        </div>

        {/* Warnings */}
        {(!apiBase||!creds.some(c=>c.service==="notion"))&&<div style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--amber)",padding:"7px 10px",background:"rgba(212,168,67,.07)",borderRadius:"5px"}}>
          Connect Notion in Settings to sync with your Notion Calendar. Timetable classes from localStorage still show.
        </div>}
        {err&&<div style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--red)"}}>{err}</div>}
        {loading&&<div style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)"}}>Fetching from Notion…</div>}

        <DayUtilization events={allEvents.filter(e=>e.date===todayStr)} eventTypes={eventTypes}/>

        {/* Week grid */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"5px",flex:1}}>
          {days.map(day=>{
            const ds=ymd(day)
            const isToday=ds===todayStr
            const isWknd=day.getDay()===0||day.getDay()===6
            const dayEvts=allEvents.filter(e=>e.date===ds).sort((a,b)=>(a.time||"99:99")>(b.time||"99:99")?1:-1)
            return(
              <div key={ds} style={{minHeight:"110px",opacity:isWknd?.65:1}}>
                <div style={{fontSize:"10px",fontFamily:"var(--mono)",marginBottom:"5px",padding:"4px 5px",
                  borderBottom:"2px solid",borderColor:isToday?"var(--amber)":isWknd?"var(--m)":"var(--b)",
                  background:isToday?"rgba(212,168,67,.08)":"transparent",borderRadius:"4px 4px 0 0"}}>
                  <div style={{color:isToday?"var(--amber)":isWknd?"var(--m)":"var(--d)"}}>{day.toLocaleDateString("en-GB",{weekday:"short"}).toUpperCase()}</div>
                  <div style={{fontSize:"14px",fontWeight:"500",color:isToday?"var(--amber)":"var(--t)",marginTop:"1px"}}>{day.getDate()}</div>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:"3px"}}>
                  {dayEvts.length===0&&!loading&&<div style={{fontSize:"9px",color:"var(--m)",fontFamily:"var(--mono)"}}>—</div>}
                  {dayEvts.map(ev=>(
                    <div key={ev.id||ev.title+ev.date}
                      onClick={()=>ev.notion_url&&window.open(ev.notion_url,"_blank")}
                      title={`${ev.title}${ev.room?" · "+ev.room:""}${ev.time?" · "+ev.time:""}`}
                      style={{fontSize:"9px",padding:"3px 5px",borderRadius:"3px",lineHeight:"1.4",wordBreak:"break-word",
                        background:(ev.color||"var(--teal)")+"1A",color:ev.color||"var(--teal)",
                        borderLeft:"2px solid "+(ev.color||"var(--teal)"),
                        cursor:ev.notion_url?"pointer":"default"}}>
                      {ev.time&&<span style={{fontFamily:"var(--mono)",opacity:.8,marginRight:"3px"}}>{ev.time}</span>}
                      {ev.title.length>22?ev.title.slice(0,20)+"…":ev.title}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {/* Legend */}
        <div style={{display:"flex",gap:"14px",fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)",flexWrap:"wrap"}}>
          {[["var(--teal)","classes (timetable)"],["var(--red)","deadlines"],["var(--amber)","reminders"],["#6B7FD4","events"],["#9B6BD4","meetings"]].map(([c,l])=>(
            <span key={l}><span style={{color:c}}>■</span> {l}</span>
          ))}
          <span style={{marginLeft:"auto"}}>click any Notion event to open it</span>
        </div>

        {/* Add event modal */}
        {addOpen&&(
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300}} onClick={()=>setAddOpen(false)}>
            <div onClick={e=>e.stopPropagation()} style={{background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"10px",padding:"22px",width:"380px"}}>
              <div style={{fontSize:"14px",fontWeight:"500",marginBottom:"14px"}}>Add to Notion Calendar</div>
              <form onSubmit={submitAdd} style={{display:"flex",flexDirection:"column",gap:"9px"}}>
                <input value={addForm.title} onChange={e=>setAddForm(f=>({...f,title:e.target.value}))} placeholder="Event title" required
                  style={{background:"var(--s2)",color:"var(--t)",border:"1px solid var(--b)",borderRadius:"6px",padding:"8px 10px",fontSize:"13px"}}/>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"8px"}}>
                  <div>
                    <Eyebrow style={{marginBottom:"3px"}}>DATE</Eyebrow>
                    <input type="date" value={addForm.date} onChange={e=>setAddForm(f=>({...f,date:e.target.value}))} required
                      style={{width:"100%",background:"var(--s2)",color:"var(--t)",border:"1px solid var(--b)",borderRadius:"6px",padding:"7px 8px",fontSize:"12px"}}/>
                  </div>
                  <div>
                    <Eyebrow style={{marginBottom:"3px"}}>TIME (optional)</Eyebrow>
                    <input type="time" value={addForm.time} onChange={e=>setAddForm(f=>({...f,time:e.target.value}))}
                      style={{width:"100%",background:"var(--s2)",color:"var(--t)",border:"1px solid var(--b)",borderRadius:"6px",padding:"7px 8px",fontSize:"12px"}}/>
                  </div>
                  <div>
                    <Eyebrow style={{marginBottom:"3px"}}>UNTIL (optional)</Eyebrow>
                    <input type="time" value={addForm.endTime} onChange={e=>setAddForm(f=>({...f,endTime:e.target.value}))}
                      style={{width:"100%",background:"var(--s2)",color:"var(--t)",border:"1px solid var(--b)",borderRadius:"6px",padding:"7px 8px",fontSize:"12px"}}/>
                  </div>
                </div>
                <div>
                  <Eyebrow style={{marginBottom:"5px"}}>TYPE</Eyebrow>
                  <div style={{display:"flex",flexWrap:"wrap",gap:"5px",marginBottom:"6px"}}>
                    {eventTypes.map(t=>(
                      <button key={t.name} type="button" onClick={()=>setAddForm(f=>({...f,type:t.name}))}
                        style={{fontSize:"10px",fontFamily:"var(--mono)",padding:"4px 8px",borderRadius:"4px",border:"1px solid",cursor:"pointer",
                          borderColor:addForm.type===t.name?t.hex:"var(--b)",
                          background:addForm.type===t.name?t.hex+"22":"transparent",
                          color:addForm.type===t.name?t.hex:"var(--d)"}}>
                        {t.name}
                      </button>
                    ))}
                    <button type="button" onClick={()=>setAddingType(a=>!a)}
                      style={{fontSize:"10px",fontFamily:"var(--mono)",padding:"4px 8px",borderRadius:"4px",
                        border:"1px dashed var(--b)",cursor:"pointer",color:"var(--m)",background:"transparent"}}>
                      + new type
                    </button>
                  </div>
                  {addingType&&(
                    <div style={{padding:"10px",background:"var(--s2)",borderRadius:"6px",marginBottom:"4px"}}>
                      <input value={newTypeName} onChange={e=>setNewTypeName(e.target.value)} placeholder="type name"
                        style={{width:"100%",background:"var(--s3)",color:"var(--t)",border:"1px solid var(--b)",borderRadius:"4px",padding:"6px 8px",fontSize:"12px",marginBottom:"8px"}}/>
                      <Eyebrow style={{marginBottom:"5px"}}>COLOUR — matches Notion's own options exactly</Eyebrow>
                      <div style={{display:"flex",flexWrap:"wrap",gap:"6px",marginBottom:"8px"}}>
                        {NOTION_COLORS.map(c=>(
                          <button key={c.name} type="button" onClick={()=>setNewTypeColor(c.name)} title={c.name}
                            style={{width:"22px",height:"22px",borderRadius:"5px",background:c.hex,cursor:"pointer",
                              border:newTypeColor===c.name?"2px solid var(--t)":"2px solid transparent"}}/>
                        ))}
                      </div>
                      <button type="button" onClick={async()=>{
                          if(!newTypeName.trim())return
                          try{ await createNotionEventType(newTypeName.trim(),newTypeColor); setAddForm(f=>({...f,type:newTypeName.trim()})); setNewTypeName("");setAddingType(false) }
                          catch(e){ setAddMsg("Error: "+e.message) }
                        }}
                        style={{width:"100%",background:"var(--s3)",border:"1px solid var(--b)",color:"var(--d)",borderRadius:"4px",padding:"6px",cursor:"pointer",fontSize:"11px",fontFamily:"var(--mono)"}}>
                        add type
                      </button>
                    </div>
                  )}
                </div>
                <input value={addForm.notes} onChange={e=>setAddForm(f=>({...f,notes:e.target.value}))} placeholder="Notes (optional)"
                  style={{background:"var(--s2)",color:"var(--t)",border:"1px solid var(--b)",borderRadius:"6px",padding:"8px 10px",fontSize:"13px"}}/>
                {addMsg&&<div style={{fontSize:"11px",fontFamily:"var(--mono)",color:addMsg.includes("Error")?"var(--red)":"var(--teal)"}}>{addMsg}</div>}
                <div style={{display:"flex",gap:"8px",marginTop:"2px"}}>
                  <button type="button" onClick={()=>setAddOpen(false)} style={{flex:1,background:"transparent",border:"1px solid var(--b)",color:"var(--d)",borderRadius:"6px",padding:"8px",cursor:"pointer",fontSize:"13px"}}>cancel</button>
                  <button type="submit" disabled={adding} style={{flex:1,background:"var(--amber)",color:"#000",border:"none",borderRadius:"6px",padding:"8px",cursor:"pointer",fontSize:"13px",fontWeight:"600"}}>
                    {adding?"adding…":"add to notion"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Digest view ──────────────────────────────────────────────────────
  function DigestView(){
    const [weather,setWeather]=useState(null)
    const [weatherErr,setWeatherErr]=useState("")
    const [location,setLocation]=useState(null)
    const [editingLoc,setEditingLoc]=useState(false)
    const [locInput,setLocInput]=useState("")
    const [todayEvents,setTodayEvents]=useState([])
    const [upcoming,setUpcoming]=useState([])
    const [upcomingFilter,setUpcomingFilter]=useState("all")
    const [briefing,setBriefing]=useState(null)
    const [briefingLoading,setBriefingLoading]=useState(false)
    const [briefingErr,setBriefingErr]=useState("")

    // Location — defaults to Edinburgh, editable but tucked away behind a
    // pencil icon (progressive disclosure: most days nobody touches this)
    useEffect(()=>{
      let loc=null
      try{ loc=JSON.parse(localStorage.getItem("lifeos_weather_loc")||"null") }catch{}
      setLocation(loc||{name:"Edinburgh, UK",lat:55.9533,lon:-3.1883})
    },[])
    useEffect(()=>{
      if(!location) return
      fetchWeather(location.lat,location.lon).then(setWeather).catch(e=>setWeatherErr(e.message))
    },[location])
    async function saveLocation(){
      if(!locInput.trim()) return
      try{
        const loc=await geocodeCity(locInput.trim())
        setLocation(loc); try{localStorage.setItem("lifeos_weather_loc",JSON.stringify(loc))}catch{}
        setEditingLoc(false);setLocInput("")
      }catch(e){ setWeatherErr(e.message) }
    }

    // Today's events + the next 30 days — no manual fetch button, this just loads.
    useEffect(()=>{
      if(!apiBase || !creds.some(c=>c.service==="notion")) return
      const t=ymd(new Date())
      notionCalQuery(t,t).then(setTodayEvents).catch(()=>{})
      notionCalQuery(t,ymd(new Date(Date.now()+30*86400000))).then(evts=>setUpcoming(evts.filter(e=>e.date!==t))).catch(()=>{})
    },[apiBase,creds])

    async function buildBriefing(){
      if(!apiBase || !creds.some(c=>c.service==="gemini")) return
      setBriefingLoading(true);setBriefingErr("")
      try{
        let reminders=[],flagged=[]
        try{ const r=await backendFetch("/api/digest"); if(r.ok){const d=await r.json();reminders=d.reminders||[];flagged=d.flagged||[]} }catch{}

        // Full Canvas context — deadlines, todo, announcements
        let canvasCtx=""
        if(creds.some(c=>c.service==="canvas")){
          try{
            const cs=await fetchCanvasSummary()
            if(cs){
              const dlLines=(cs.deadlines||[]).map(d=>`- ${d.title} [${d.course_name}] due ${new Date(d.due_at).toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"})} (${d.days_until}d)${d.points?` — ${d.points}pts`:""}`).join("\n")
              const todoLines=(cs.todo||[]).slice(0,8).map(t=>`- ${t.title} [${t.course_name}]${t.due_at?` due ${new Date(t.due_at).toLocaleDateString("en-GB",{day:"numeric",month:"short"})}`:""}${t.points?` — ${t.points}pts`:""}`).join("\n")
              const annLines=(cs.announcements||[]).slice(0,4).map(a=>`- [${a.course_name}] ${a.title}`).join("\n")
              canvasCtx=`Canvas deadlines (next 14d):\n${dlLines||"None"}\n\nCanvas todo (unsubmitted):\n${todoLines||"None"}\n\nCanvas announcements:\n${annLines||"None"}`
            }
          }catch{}
        }

        const projSummary=projects.map(p=>`${p.category}: "${p.title}" (${p.status})`).join(", ")
        const eventLines=todayEvents.map(e=>`${e.time||"—"}${e.endTime?"-"+e.endTime:""} [${e.type}] ${e.title}${e.room?" @ "+e.room:""}${e.notes?" — "+e.notes:""}`).join("\n")||"Nothing scheduled today."
        const reminderLines=reminders.map(r=>`${r.title} — ${r.body}`).join("\n")||"None"
        const flaggedLines=flagged.map(f=>`${f.subject} (${f.why})`).join("\n")||"None"

        const raw=await gemini(apiBase,me?.deployment?.relay_token,
          "You are a sharp, genuinely insightful personal secretary for a multidisciplinary engineering student who also runs a business and creative projects. Be specific and direct, never generic filler — skip a section entirely rather than pad it.",
          "Today's calendar events:\n"+eventLines+"\n\nDeadline reminders due today:\n"+reminderLines+"\n\nFlagged emails:\n"+flaggedLines+"\n\n"+(canvasCtx?canvasCtx+"\n\n":"")+
          "Active projects: "+projSummary+"\n\n"+
          "Write two things as strict JSON:\n1. \"actionable\" — a time-ordered list of what to actually DO today: where, when, why it matters. Merge consecutive same-type events into one entry. Flag any Canvas deadlines due in the next 48h prominently.\n2. \"insights\" — things worth knowing that need no action. Flag real pressure points (e.g. a deadline in 2 days that should start today), patterns in todo backlog, notable emails.\n\n"+
          "Output ONLY this JSON, no markdown fences: {\"actionable\":[{\"time\":\"\",\"title\":\"\",\"context\":\"\"}],\"insights\":[{\"text\":\"\"}]}"
        )
        const clean=raw.replace(/^```json\s*/i,"").replace(/^```\s*/i,"").replace(/```\s*$/i,"").trim()
        setBriefing(JSON.parse(clean))
      }catch(e){ setBriefingErr(e.message) }
      finally{ setBriefingLoading(false) }
    }
    // Auto-build once there's something to build from — the primary path
    // needs zero clicks. Manual refresh stays available as a small, quiet
    // secondary action, not the main way in.
    useEffect(()=>{ buildBriefing() },[apiBase,creds,todayEvents.length])

    const todayLabel=new Date().toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"})
    const nowLabel=new Date().toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})
    const upcomingTypes=["all",...new Set(upcoming.map(e=>e.type))].slice(0,5)
    const filteredUpcoming=upcoming.filter(e=>upcomingFilter==="all"||e.type===upcomingFilter).slice(0,12)

    return(
      <div style={{display:"flex",flexDirection:"column",height:"100%",padding:"20px 26px 16px",minHeight:0}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:"12px",flexShrink:0}}>
          <div>
            <div style={{fontSize:"16px",fontWeight:"500"}}>{todayLabel}</div>
            <div style={{fontSize:"11px",fontFamily:"var(--mono)",color:"var(--d)"}}>{nowLabel}</div>
          </div>
          <button onClick={buildBriefing} disabled={briefingLoading} title="refresh"
            style={{background:"none",border:"1px solid var(--b)",borderRadius:"6px",width:"30px",height:"30px",display:"flex",alignItems:"center",justifyContent:"center",cursor:briefingLoading?"default":"pointer",color:"var(--d)",flexShrink:0}}>
            <RotateCw size={13} strokeWidth={1.5} style={briefingLoading?{animation:"spin 1s linear infinite"}:{}}/>
          </button>
        </div>

        {!apiBase && <div style={{fontSize:"12px",color:"var(--m)",fontStyle:"italic",marginBottom:"12px",flexShrink:0}}>Set up your backend in Settings to see your real digest.</div>}
        {briefingErr && <div style={{fontSize:"11px",fontFamily:"var(--mono)",color:"var(--red)",marginBottom:"10px",padding:"7px 10px",background:"rgba(192,90,74,.08)",borderRadius:"5px",flexShrink:0}}>{briefingErr}</div>}

        {/* Today (left) + Worth knowing (right) — each scrolls independently */}
        <div style={{display:"flex",gap:"14px",flex:1,minHeight:0,marginBottom:"12px"}}>
          <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"8px",overflow:"hidden"}}>
            <div style={{padding:"9px 13px",borderBottom:"1px solid var(--b)",flexShrink:0}}><Eyebrow>TODAY</Eyebrow></div>
            <div style={{flex:1,overflowY:"auto",padding:"2px 13px 10px"}}>
              {briefingLoading&&!briefing&&<div style={{fontSize:"11px",color:"var(--m)",padding:"10px 0"}}>Building…</div>}
              {briefing?.actionable?.length ? briefing.actionable.map((a,i)=>(
                <div key={i} style={{padding:"9px 0",borderBottom:i<briefing.actionable.length-1?"1px solid var(--b)":"none"}}>
                  <div style={{display:"flex",gap:"8px",alignItems:"baseline"}}>
                    {a.time&&<span style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--amber)",flexShrink:0}}>{a.time}</span>}
                    <span style={{fontSize:"13px"}}>{a.title}</span>
                  </div>
                  {a.context&&<div style={{fontSize:"11px",color:"var(--d)",marginTop:"3px",lineHeight:"1.5"}}>{a.context}</div>}
                </div>
              )) : !briefingLoading && <div style={{fontSize:"12px",color:"var(--m)",fontStyle:"italic",padding:"10px 0"}}>Nothing on today.</div>}
            </div>
          </div>

          <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"8px",overflow:"hidden"}}>
            <div style={{padding:"9px 13px",borderBottom:"1px solid var(--b)",flexShrink:0}}><Eyebrow>WORTH KNOWING</Eyebrow></div>
            <div style={{flex:1,overflowY:"auto",padding:"2px 13px 10px"}}>
              {briefing?.insights?.length ? briefing.insights.map((ins,i)=>(
                <div key={i} style={{display:"flex",gap:"7px",padding:"7px 0",borderBottom:i<briefing.insights.length-1?"1px solid var(--b)":"none"}}>
                  <span style={{color:"var(--amber)",fontSize:"10px",paddingTop:"2px"}}>▸</span>
                  <span style={{fontSize:"12px",lineHeight:"1.5"}}>{ins.text}</span>
                </div>
              )) : !briefingLoading && <div style={{fontSize:"12px",color:"var(--m)",fontStyle:"italic",padding:"6px 0 10px"}}>Nothing flagged — quiet day.</div>}

              {upcoming.length>0&&(
                <div style={{marginTop:"10px",paddingTop:"9px",borderTop:"1px solid var(--b)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"6px"}}>
                    <Eyebrow>UPCOMING</Eyebrow>
                    <div style={{display:"flex",gap:"3px"}}>
                      {upcomingTypes.map(t=>(
                        <button key={t} onClick={()=>setUpcomingFilter(t)}
                          style={{fontSize:"8px",fontFamily:"var(--mono)",padding:"2px 6px",borderRadius:"999px",border:"1px solid",cursor:"pointer",
                            borderColor:upcomingFilter===t?"var(--amber)":"var(--b)",color:upcomingFilter===t?"var(--amber)":"var(--m)",background:"transparent"}}>
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                  {filteredUpcoming.map(e=>(
                    <div key={e.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",fontSize:"11px",gap:"8px"}}>
                      <span style={{display:"flex",alignItems:"center",gap:"5px",overflow:"hidden",minWidth:0}}>
                        <Dot color={e.color} size={5}/>
                        <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.title}</span>
                      </span>
                      <span style={{fontFamily:"var(--mono)",color:"var(--d)",flexShrink:0}}>{daysUntilLabel(e.date)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Time-allotment indicator */}
        {todayEvents.length>0 && <div style={{marginBottom:"12px",flexShrink:0}}><DayUtilization events={todayEvents} eventTypes={eventTypes}/></div>}

        {/* Weather — own horizontal scroll for the hourly strip */}
        <div style={{flexShrink:0,background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"8px",padding:"11px 14px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px"}}>
            <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
              <MapPin size={11} color="var(--d)"/>
              <span style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)"}}>{location?.name||"…"}</span>
              <button onClick={()=>setEditingLoc(v=>!v)} style={{background:"none",border:"none",cursor:"pointer",color:"var(--m)",padding:0,display:"flex"}}><Pencil size={9}/></button>
            </div>
            {weather&&<div style={{display:"flex",alignItems:"center",gap:"5px"}}>
              <weather.Icon size={13} color="var(--amber)" strokeWidth={1.5}/>
              <span style={{fontSize:"13px",fontFamily:"var(--mono)"}}>{weather.current}°</span>
              <span style={{fontSize:"10px",color:"var(--d)"}}>{weather.label}</span>
            </div>}
          </div>
          {editingLoc&&(
            <div style={{display:"flex",gap:"6px",marginBottom:"8px"}}>
              <input value={locInput} onChange={e=>setLocInput(e.target.value)} placeholder="city name" onKeyDown={e=>e.key==="Enter"&&saveLocation()}
                style={{flex:1,background:"var(--s3)",color:"var(--t)",border:"1px solid var(--b)",borderRadius:"4px",padding:"4px 8px",fontSize:"11px"}}/>
              <button onClick={saveLocation} style={{fontSize:"10px",fontFamily:"var(--mono)",background:"var(--s2)",border:"1px solid var(--b)",borderRadius:"4px",padding:"4px 9px",cursor:"pointer",color:"var(--d)"}}>set</button>
            </div>
          )}
          {weatherErr&&<div style={{fontSize:"10px",color:"var(--red)",marginBottom:"6px"}}>{weatherErr}</div>}
          {weather&&(
            <div style={{display:"flex",gap:"14px",overflowX:"auto",paddingBottom:"2px"}}>
              {weather.hourly.map((h,i)=>(
                <div key={i} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"3px",flexShrink:0,minWidth:"32px"}}>
                  <span style={{fontSize:"9px",fontFamily:"var(--mono)",color:"var(--m)"}}>{h.time}</span>
                  <h.Icon size={12} color="var(--d)" strokeWidth={1.5}/>
                  <span style={{fontSize:"10px",fontFamily:"var(--mono)"}}>{h.temp}°</span>
                </div>
              ))}
              <div style={{width:"1px",background:"var(--b)",flexShrink:0}}/>
              {weather.daily.map((d,i)=>(
                <div key={i} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"3px",flexShrink:0,minWidth:"44px"}}>
                  <span style={{fontSize:"9px",fontFamily:"var(--mono)",color:"var(--m)"}}>{new Date(d.date).toLocaleDateString("en-GB",{weekday:"short"})}</span>
                  <d.Icon size={12} color="var(--d)" strokeWidth={1.5}/>
                  <span style={{fontSize:"10px",fontFamily:"var(--mono)"}}>{d.max}°/{d.min}°</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ─── Modals ────────────────────────────────────────────────────────────────
  function AddFileModal(){
    const [f,setF]=useState({name:"",type:"audio",device:"cloud",path:"",projectId:addFileFor||""})
    const s=(k,v)=>setF(x=>({...x,[k]:v}))
    function submit(e){
      e.preventDefault()
      if(!f.name||!f.path) return
      const fp={id:"fp_"+Date.now(),...f,createdAt:new Date().toISOString()}
      const nf=[...files,fp]
      setFiles(nf);save({files:nf});setAddFileFor(null)
    }
    return(
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200}} onClick={()=>setAddFileFor(null)}>
        <div onClick={e=>e.stopPropagation()} style={{background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"10px",padding:"24px",width:"380px"}}>
          <div style={{fontSize:"14px",fontWeight:"500",marginBottom:"16px"}}>Add file pointer</div>
          <form onSubmit={submit} style={{display:"flex",flexDirection:"column",gap:"10px"}}>
            {[["Name","name","filename or description"],["Path / URL","path","local path or https://..."]].map(([l,k,ph])=>(
              <div key={k}>
                <Eyebrow style={{marginBottom:"4px"}}>{l.toUpperCase()}</Eyebrow>
                <input value={f[k]} onChange={e=>s(k,e.target.value)} placeholder={ph} required={k==="name"||k==="path"}
                  style={{width:"100%",background:"var(--s2)",color:"var(--t)",border:"1px solid var(--b)",borderRadius:"6px",padding:"8px 10px",fontSize:"13px"}}/>
              </div>
            ))}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"8px"}}>
              {[["Type","type",Object.keys(FILE_ICONS)],["Device","device",Object.keys(DEVICE_ICONS)],["Project","projectId",[""].concat(projects.map(p=>p.id))]].map(([l,k,opts])=>(
                <div key={k}>
                  <Eyebrow style={{marginBottom:"4px"}}>{l.toUpperCase()}</Eyebrow>
                  <select value={f[k]} onChange={e=>s(k,e.target.value)}
                    style={{width:"100%",background:"var(--s2)",color:"var(--t)",border:"1px solid var(--b)",borderRadius:"6px",padding:"7px 8px",fontSize:"12px"}}>
                    {opts.map(o=><option key={o} value={o}>{k==="projectId"?(o===""?"— none —":(projects.find(p=>p.id===o)?.emoji+" "+projects.find(p=>p.id===o)?.title||o)):o}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:"8px",marginTop:"4px"}}>
              <button type="button" onClick={()=>setAddFileFor(null)} style={{flex:1,background:"transparent",border:"1px solid var(--b)",color:"var(--d)",borderRadius:"6px",padding:"8px",cursor:"pointer",fontSize:"13px"}}>cancel</button>
              <button type="submit" style={{flex:1,background:"var(--amber)",color:"#000",border:"none",borderRadius:"6px",padding:"8px",cursor:"pointer",fontSize:"13px",fontWeight:"600"}}>add</button>
            </div>
          </form>
        </div>
      </div>
    )
  }

  function AddProjectModal(){
    const [f,setF]=useState({title:"",emoji:"",category:"creative",description:"",sections:categories.creative?.sections||["tasks"]})
    const [newCat,setNewCat]=useState("")
    const [newCatColor,setNewCatColor]=useState(PROJECT_COLORS[0].hex)
    const [newCatIcon,setNewCatIcon]=useState("File")
    const [newCatSections,setNewCatSections]=useState(["tasks"])
    const [addingCat,setAddingCat]=useState(false)
    const s=(k,v)=>setF(x=>({...x,[k]:v}))

    function pickCategory(k){
      setF(x=>({...x,category:k,sections:categories[k]?.sections||["tasks"]}))
    }
    function toggleSection(k){
      setF(x=>({...x,sections:x.sections.includes(k)?x.sections.filter(s=>s!==k):[...x.sections,k]}))
    }
    function toggleNewCatSection(k){
      setNewCatSections(cur=>cur.includes(k)?cur.filter(s=>s!==k):[...cur,k])
    }

    function addCategory(e){
      e.preventDefault()
      const key=newCat.trim().toLowerCase().replace(/\s+/g,"-")
      if(!key) return
      const nc={...categories,[key]:{color:newCatColor,icon:newCatIcon,sections:newCatSections}}
      setCategories(nc);save({categories:nc})
      setF(x=>({...x,category:key,sections:newCatSections}))
      setNewCat("");setNewCatIcon("File");setNewCatSections(["tasks"]);setAddingCat(false)
    }

    function submit(e){
      e.preventDefault()
      if(!f.title) return
      const p={id:"p_"+Date.now(),...f,status:"Not started",notion_url:null,subprojects:[],files:[]}
      const np=[...projects,p]
      setProjects(np);setSel(p);setTab("projects")
      save({projects:np});setAddProjOpen(false)
      createNotionProject(p).then(created=>{
        if(created?.url){const withUrl=np.map(x=>x.id===p.id?{...x,notion_url:created.url,notion_page_id:created.pageId}:x);setProjects(withUrl);save({projects:withUrl})}
      })
    }

    return(
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200}} onClick={()=>setAddProjOpen(false)}>
        <div onClick={e=>e.stopPropagation()} style={{background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"10px",padding:"24px",width:"380px",maxHeight:"90vh",overflowY:"auto"}}>
          <div style={{fontSize:"14px",fontWeight:"500",marginBottom:"16px"}}>New project</div>
          <form onSubmit={submit} style={{display:"flex",flexDirection:"column",gap:"10px"}}>
            <div style={{display:"grid",gridTemplateColumns:"48px 1fr",gap:"8px"}}>
              <input value={f.emoji} onChange={e=>s("emoji",e.target.value)} maxLength={2}
                placeholder="—"
                style={{background:"var(--s2)",color:"var(--t)",border:"1px solid var(--b)",borderRadius:"6px",padding:"8px",fontSize:"18px",textAlign:"center"}}/>
              <input value={f.title} onChange={e=>s("title",e.target.value)} placeholder="Project name" required
                style={{background:"var(--s2)",color:"var(--t)",border:"1px solid var(--b)",borderRadius:"6px",padding:"8px 10px",fontSize:"13px"}}/>
            </div>

            <div>
              <Eyebrow style={{marginBottom:"6px"}}>TYPE</Eyebrow>
              <div style={{display:"flex",flexWrap:"wrap",gap:"5px",marginBottom:"6px"}}>
                {Object.entries(categories).map(([k,v])=>(
                  <button key={k} type="button" onClick={()=>pickCategory(k)}
                    style={{fontSize:"10px",fontFamily:"var(--mono)",padding:"4px 8px",borderRadius:"4px",border:"1px solid",cursor:"pointer",
                      borderColor:f.category===k?(v.color||"#666"):"var(--b)",
                      background:f.category===k?(v.color||"#666")+"22":"transparent",
                      color:f.category===k?(v.color||"#666"):"var(--d)"}}>
                    {k}
                  </button>
                ))}
                <button type="button" onClick={()=>setAddingCat(a=>!a)}
                  style={{fontSize:"10px",fontFamily:"var(--mono)",padding:"4px 8px",borderRadius:"4px",
                    border:"1px dashed var(--b)",cursor:"pointer",color:"var(--m)",background:"transparent"}}>
                  + new type
                </button>
              </div>
              {categories[f.category]?.hint&&<div style={{fontSize:"9px",color:"var(--m)",fontStyle:"italic",marginBottom:"6px"}}>{categories[f.category].hint} — sections below, edit as you like</div>}
              {addingCat&&(
                <div style={{display:"grid",gridTemplateColumns:"1fr",gap:"6px",padding:"10px",background:"var(--s2)",borderRadius:"6px"}}>
                  <input value={newCat} onChange={e=>setNewCat(e.target.value)} placeholder="type name"
                    style={{background:"var(--s3)",color:"var(--t)",border:"1px solid var(--b)",borderRadius:"4px",padding:"6px 8px",fontSize:"12px"}}/>
                  <div>
                    <Eyebrow style={{marginBottom:"5px"}}>COLOUR</Eyebrow>
                    <div style={{display:"flex",flexWrap:"wrap",gap:"6px"}}>
                      {PROJECT_COLORS.map(c=>(
                        <button key={c.name} type="button" onClick={()=>setNewCatColor(c.hex)} title={c.name}
                          style={{width:"22px",height:"22px",borderRadius:"5px",background:c.hex,cursor:"pointer",
                            border:newCatColor===c.hex?"2px solid var(--t)":"2px solid transparent"}}/>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Eyebrow style={{marginBottom:"5px"}}>PICK AN ICON FOR THIS TYPE</Eyebrow>
                    <div style={{display:"flex",flexWrap:"wrap",gap:"5px",maxHeight:"90px",overflowY:"auto"}}>
                      {PICKER_ICONS.map(name=>(
                        <button key={name} type="button" onClick={()=>setNewCatIcon(name)}
                          title={name}
                          style={{width:"28px",height:"28px",display:"flex",alignItems:"center",justifyContent:"center",
                            background:newCatIcon===name?"var(--amber)22":"transparent",
                            border:"1px solid",borderColor:newCatIcon===name?"var(--amber)":"var(--b)",
                            borderRadius:"5px",cursor:"pointer"}}>
                          <LucideIcon name={name} size={13} color={newCatIcon===name?"var(--amber)":"var(--d)"}/>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Eyebrow style={{marginBottom:"5px"}}>SECTIONS THIS TYPE STARTS WITH</Eyebrow>
                    <div style={{display:"flex",flexWrap:"wrap",gap:"5px"}}>
                      {Object.entries(SECTION_DEFS).map(([k,def])=>(
                        <button key={k} type="button" onClick={()=>toggleNewCatSection(k)}
                          style={{display:"flex",alignItems:"center",gap:"4px",fontSize:"9px",fontFamily:"var(--mono)",padding:"4px 8px",borderRadius:"4px",border:"1px solid",cursor:"pointer",
                            borderColor:newCatSections.includes(k)?"var(--amber)":"var(--b)",
                            background:newCatSections.includes(k)?"rgba(212,168,67,.1)":"transparent",
                            color:newCatSections.includes(k)?"var(--amber)":"var(--m)"}}>
                          <def.Icon size={10} strokeWidth={1.5}/>{def.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button type="button" onClick={addCategory}
                    style={{background:"var(--s3)",border:"1px solid var(--b)",color:"var(--d)",borderRadius:"4px",padding:"5px",cursor:"pointer",fontSize:"11px",fontFamily:"var(--mono)"}}>
                    add type
                  </button>
                </div>
              )}
            </div>

            <input value={f.description} onChange={e=>s("description",e.target.value)} placeholder="Short description (optional)"
              style={{background:"var(--s2)",color:"var(--t)",border:"1px solid var(--b)",borderRadius:"6px",padding:"8px 10px",fontSize:"13px"}}/>
            <div style={{display:"flex",gap:"8px",marginTop:"4px"}}>
              <button type="button" onClick={()=>setAddProjOpen(false)} style={{flex:1,background:"transparent",border:"1px solid var(--b)",color:"var(--d)",borderRadius:"6px",padding:"9px",cursor:"pointer",fontSize:"13px"}}>cancel</button>
              <button type="submit" style={{flex:1,background:"var(--amber)",color:"#000",border:"none",borderRadius:"6px",padding:"9px",cursor:"pointer",fontSize:"13px",fontWeight:"600"}}>create</button>
            </div>
          </form>
        </div>
      </div>
    )
  }
  // ── Canvas helpers ────────────────────────────────────────────────────
  async function fetchCanvasSummary(){
    if(!apiBase||!creds.some(c=>c.service==="canvas")) return null
    try{ const r=await backendFetch("/api/canvas/summary"); return r.ok?await r.json():null }catch{ return null }
  }
  async function importCanvasCourse(course, deadlines){
    const tasks=(deadlines||[])
      .filter(d=>d.course_id===course.id)
      .map(d=>({id:"ct_"+d.id, text:d.title, due:d.due_at?new Date(d.due_at).toISOString().slice(0,10):null, done:false, kind:"task", meta:d.points?`${d.points}pts`:""}))
    const node={
      id:"n_canvas_"+course.id, type:"project", title:course.name,
      emoji:"📚", category:"academic", sections:["tasks","notes"],
      tasks, notes:`Canvas course: ${course.code}${course.grade?`\nCurrent grade: ${course.grade} (${course.score}%)`:""} `,
      children:[], files:[], links:[], tables:[], charts:[],
      status:"In progress", color:"#4B9E82", canvas_course_id:course.id,
    }
    const np=[node,...projects]
    setProjects(np); save({projects:np}); setSel(node); setTab("projects")
    flash(`Imported "${course.name}" with ${tasks.length} deadline${tasks.length!==1?"s":""}`, "ok")
  }

  // ─── Settings tab — wires the dashboard to worker.js (auth, vault, BYOC) ──
  // ─── Uploader tab — Blender-workspace philosophy: same projects, a
  // publishing lens over them. Formats are reusable presets; the queue is
  // durable (server-side D1), so closing the app never loses a queued job.
  const PLATFORM_SETTINGS = {
    tiktok:    [{key:"caption",label:"Caption"},{key:"image_text",label:"On-image text"},{key:"tags",label:"Tags"}],
    instagram: [{key:"caption",label:"Caption"},{key:"hashtags",label:"Hashtags"},{key:"collaborators",label:"Collaborators"},{key:"account",label:"Account (if several)"}],
    youtube:   [{key:"title",label:"Title"},{key:"description",label:"Description"},{key:"tags",label:"Tags"},{key:"visibility",label:"Visibility (public/unlisted)"}],
    soundcloud:[{key:"title",label:"Title"},{key:"description",label:"Description"},{key:"tags",label:"Tags"}],
  }
  function UploaderTab(){
    const [formats,setFormats]=useState([])
    const [jobs,setJobs]=useState([])
    const [zapActions,setZapActions]=useState([])
    const [actionMap,setActionMap]=useState(()=>{
      try{ return JSON.parse(localStorage.getItem("lifeos_zapier_map")||"{}") }catch{ return {} }
    })
    const [addingFormat,setAddingFormat]=useState(false)
    const [fmt,setFmt]=useState({name:"",source_folder:"",pick_count:1,selection:"random",caption_template:"",hashtags:"",platforms:[]})
    const [wizard,setWizard]=useState(null)
    const [draining,setDraining]=useState(false)
    const [msg,setMsg]=useState("")
    const hasZapier = creds.some(c=>c.service==="zapier")

    function saveActionMap(m){ setActionMap(m); try{localStorage.setItem("lifeos_zapier_map",JSON.stringify(m))}catch{} }

    async function refresh(){
      if(!apiBase||!me?.user) return
      try{ const r=await backendFetch("/api/uploader/formats"); if(r.ok) setFormats((await r.json()).formats) }catch{}
      try{ const r=await backendFetch("/api/uploader/jobs"); if(r.ok) setJobs((await r.json()).jobs) }catch{}
    }
    async function loadZapActions(){
      if(!hasZapier) return
      try{
        const r=await backendFetch("/api/zapier/actions")
        if(r.ok) setZapActions((await r.json()).actions||[])
        else setMsg("Couldn't load Zapier actions — check your NLA key in Settings.")
      }catch(e){ setMsg(e.message) }
    }
    useEffect(()=>{ refresh(); loadZapActions() },[me,hasZapier])

    async function saveFormat(){
      if(!fmt.name||!fmt.source_folder||!fmt.platforms.length){ setMsg("Name, folder, and at least one platform needed."); return }
      const r=await backendFetch("/api/uploader/formats",{method:"POST",body:JSON.stringify(fmt)})
      if(r.ok){ setAddingFormat(false); setFmt({name:"",source_folder:"",pick_count:1,selection:"random",caption_template:"",hashtags:"",platforms:[]}); refresh() }
      else setMsg((await r.json()).error||"Failed")
    }
    async function queueBatch(){
      const platforms=wizard.platforms.map(pl=>({...pl,zapier_action_id:actionMap[pl.platform]||null}))
      const r=await backendFetch("/api/uploader/jobs",{method:"POST",body:JSON.stringify({
        platforms,payload:{folder:wizard.folder,no_compression:true}
      })})
      const d=await r.json()
      if(d.ok){
        const unmapped=platforms.filter(p=>!p.zapier_action_id).map(p=>p.platform)
        setMsg(unmapped.length?`Queued. Map Zapier actions for: ${unmapped.join(", ")} to send them.`:"Queued — running now…")
        setWizard(null); refresh()
        if(!unmapped.length) runDrain()
      } else setMsg(d.error||"Failed")
    }
    async function runDrain(){
      setDraining(true)
      try{
        const r=await backendFetch("/api/uploader/drain",{method:"POST"})
        const d=await r.json()
        if(d.ok){
          const done=d.results.filter(r=>r.ok).length
          const failed=d.results.filter(r=>!r.ok).length
          setMsg(d.drained===0?"Nothing to drain.":`Ran ${d.drained} job(s): ${done} done${failed?`, ${failed} failed`:""}`)
          refresh()
        } else setMsg(d.error||"Drain failed")
      }catch(e){ setMsg(e.message) }
      finally{ setDraining(false) }
    }
    const STATUS_LABEL={queued:"queued",uploading:"uploading…",done:"done",failed:"failed",waiting_platform_auth:"needs action mapping"}

    return(
      <div style={{overflowY:"auto",padding:"22px 26px",maxWidth:"680px"}} className="fi">
        {!me?.user?(
          <div style={{fontSize:"12px",color:"var(--m)",fontStyle:"italic"}}>Sign in (Settings) to use the Uploader.</div>
        ):(
          <>
            <div style={{marginBottom:"6px"}}><Eyebrow>UPLOADER</Eyebrow></div>
            <div style={{fontSize:"11px",color:"var(--d)",lineHeight:"1.6",marginBottom:"16px"}}>Posts via Zapier — no platform API reviews needed. Files are never compressed.</div>
            {msg&&<div style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)",background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"5px",padding:"8px 10px",marginBottom:"12px"}}>{msg}</div>}

            <div style={{marginBottom:"20px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px"}}>
                <Eyebrow>PLATFORM ACTIONS</Eyebrow>
                {hasZapier&&<button onClick={loadZapActions} style={{fontSize:"9px",fontFamily:"var(--mono)",color:"var(--m)",background:"none",border:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:"3px"}}><RefreshCw size={9}/> refresh</button>}
              </div>
              {!hasZapier?(
                // Step-by-step setup card — each step is a clickable link to the exact right place
                <div style={{background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"8px",padding:"14px",display:"flex",flexDirection:"column",gap:"10px"}}>
                  <div style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)",marginBottom:"2px"}}>Three steps, then you're done forever:</div>
                  {[
                    {n:"1",label:"Get your Zapier NLA key",sub:"Free account works",url:"https://zapier.com/l/natural-language-actions",cta:"Open Zapier ↗"},
                    {n:"2",label:"Enable your social apps",sub:"TikTok, Instagram, YouTube, SoundCloud — auth to your accounts there",url:"https://zapier.com/l/natural-language-actions",cta:"Enable apps ↗"},
                    {n:"3",label:"Paste the key in Settings",sub:'Settings → CONNECTED SERVICES → Zapier → paste key → connect',url:null,cta:null},
                  ].map(step=>(
                    <div key={step.n} style={{display:"flex",gap:"10px",alignItems:"flex-start"}}>
                      <span style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--amber)",background:"rgba(212,168,67,.1)",border:"1px solid rgba(212,168,67,.25)",
                        borderRadius:"50%",width:"18px",height:"18px",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:"1px"}}>
                        {step.n}
                      </span>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:"11px",marginBottom:"2px"}}>{step.label}</div>
                        <div style={{fontSize:"9px",fontFamily:"var(--mono)",color:"var(--m)"}}>{step.sub}</div>
                      </div>
                      {step.url&&(
                        <a href={step.url} target="_blank" rel="noreferrer"
                          style={{fontSize:"9px",fontFamily:"var(--mono)",color:"var(--amber)",background:"rgba(212,168,67,.08)",
                            border:"1px solid rgba(212,168,67,.25)",borderRadius:"4px",padding:"3px 8px",textDecoration:"none",flexShrink:0,whiteSpace:"nowrap"}}>
                          {step.cta}
                        </a>
                      )}
                      {!step.url&&(
                        <button onClick={()=>setTab("settings")}
                          style={{fontSize:"9px",fontFamily:"var(--mono)",color:"var(--d)",background:"var(--s2)",
                            border:"1px solid var(--b)",borderRadius:"4px",padding:"3px 8px",cursor:"pointer",flexShrink:0,whiteSpace:"nowrap"}}>
                          Go to Settings
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ):(
                <div style={{background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"8px",overflow:"hidden"}}>
                  {Object.keys(PLATFORM_SETTINGS).map((p,i,arr)=>{
                    // Per-platform Zapier app pages — direct links to enable each one
                    const ZAPIER_APP_URLS = {
                      tiktok:    "https://zapier.com/apps/tiktok/integrations",
                      instagram: "https://zapier.com/apps/instagram/integrations",
                      youtube:   "https://zapier.com/apps/youtube/integrations",
                      soundcloud:"https://zapier.com/apps/soundcloud/integrations",
                    }
                    return(
                      <div key={p} style={{padding:"9px 13px",borderBottom:i<arr.length-1?"1px solid var(--b)":"none"}}>
                        <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                          <span style={{fontSize:"11px",width:"80px",flexShrink:0}}>{p}</span>
                          <select value={actionMap[p]||""} onChange={e=>saveActionMap({...actionMap,[p]:e.target.value})}
                            style={{flex:1,background:"var(--s3)",color:actionMap[p]?"var(--t)":"var(--m)",border:"1px solid var(--b)",borderRadius:"4px",padding:"4px 7px",fontSize:"10px"}}>
                            <option value="">— select a Zapier action —</option>
                            {zapActions.map(a=><option key={a.id} value={a.id}>{a.display_name||a.description||a.id}</option>)}
                          </select>
                          {actionMap[p]
                            ?<span style={{fontSize:"9px",color:"var(--teal)",flexShrink:0}}>✓</span>
                            :<a href={ZAPIER_APP_URLS[p]} target="_blank" rel="noreferrer"
                                title={`Enable ${p} in your Zapier account`}
                                style={{fontSize:"9px",fontFamily:"var(--mono)",color:"var(--d)",background:"var(--s2)",
                                  border:"1px solid var(--b)",borderRadius:"4px",padding:"2px 7px",textDecoration:"none",flexShrink:0,whiteSpace:"nowrap"}}>
                                enable ↗
                              </a>
                          }
                        </div>
                      </div>
                    )
                  })}
                  {zapActions.length===0&&(
                    <div style={{padding:"10px 13px",borderTop:"1px solid var(--b)",display:"flex",alignItems:"center",justifyContent:"space-between",gap:"10px"}}>
                      <span style={{fontSize:"10px",color:"var(--m)",fontStyle:"italic"}}>No actions loaded yet — enable social apps in Zapier first, then refresh.</span>
                      <a href="https://zapier.com/l/natural-language-actions" target="_blank" rel="noreferrer"
                        style={{fontSize:"9px",fontFamily:"var(--mono)",color:"var(--amber)",background:"rgba(212,168,67,.08)",
                          border:"1px solid rgba(212,168,67,.25)",borderRadius:"4px",padding:"3px 8px",textDecoration:"none",flexShrink:0,whiteSpace:"nowrap"}}>
                        Enable apps ↗
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px"}}>
              <Eyebrow>FORMATS</Eyebrow>
              <button onClick={()=>setAddingFormat(v=>!v)} style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)",background:"var(--s2)",border:"1px solid var(--b)",borderRadius:"4px",padding:"3px 9px",cursor:"pointer"}}>
                {addingFormat?"cancel":"+ new format"}
              </button>
            </div>
            {addingFormat&&(
              <div style={{background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"8px",padding:"13px",marginBottom:"10px",display:"flex",flexDirection:"column",gap:"8px"}} className="fi">
                <input value={fmt.name} onChange={e=>setFmt(f=>({...f,name:e.target.value}))} placeholder='Format name' style={{background:"var(--s3)",color:"var(--t)",border:"1px solid var(--b)",borderRadius:"5px",padding:"7px 9px",fontSize:"12px"}}/>
                <input value={fmt.source_folder} onChange={e=>setFmt(f=>({...f,source_folder:e.target.value}))} placeholder="Drive/Dropbox folder name or link" style={{background:"var(--s3)",color:"var(--t)",border:"1px solid var(--b)",borderRadius:"5px",padding:"7px 9px",fontSize:"12px"}}/>
                <div style={{display:"flex",gap:"8px"}}>
                  <label style={{display:"flex",alignItems:"center",gap:"5px",fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)"}}>
                    pick <input type="number" min="1" max="10" value={fmt.pick_count} onChange={e=>setFmt(f=>({...f,pick_count:Number(e.target.value)||1}))} style={{width:"40px",background:"var(--s3)",color:"var(--t)",border:"1px solid var(--b)",borderRadius:"4px",padding:"3px 5px",fontSize:"11px"}}/> per post
                  </label>
                  <select value={fmt.selection} onChange={e=>setFmt(f=>({...f,selection:e.target.value}))} style={{background:"var(--s3)",color:"var(--d)",border:"1px solid var(--b)",borderRadius:"4px",padding:"3px 6px",fontSize:"10px"}}>
                    <option value="random">randomize from folder</option>
                    <option value="curated">curated then randomize</option>
                    <option value="sequential">in order</option>
                  </select>
                </div>
                <input value={fmt.caption_template} onChange={e=>setFmt(f=>({...f,caption_template:e.target.value}))} placeholder="Caption template — {name} inserts the design name" style={{background:"var(--s3)",color:"var(--t)",border:"1px solid var(--b)",borderRadius:"5px",padding:"7px 9px",fontSize:"12px"}}/>
                <input value={fmt.hashtags} onChange={e=>setFmt(f=>({...f,hashtags:e.target.value}))} placeholder="#hashtags" style={{background:"var(--s3)",color:"var(--t)",border:"1px solid var(--b)",borderRadius:"5px",padding:"7px 9px",fontSize:"12px"}}/>
                <div style={{display:"flex",gap:"5px",flexWrap:"wrap"}}>
                  {Object.keys(PLATFORM_SETTINGS).map(p=>(
                    <button key={p} onClick={()=>setFmt(f=>({...f,platforms:f.platforms.includes(p)?f.platforms.filter(x=>x!==p):[...f.platforms,p]}))}
                      style={{fontSize:"10px",fontFamily:"var(--mono)",padding:"4px 9px",borderRadius:"999px",border:"1px solid",cursor:"pointer",
                        borderColor:fmt.platforms.includes(p)?"var(--amber)":"var(--b)",background:fmt.platforms.includes(p)?"rgba(212,168,67,.1)":"transparent",
                        color:fmt.platforms.includes(p)?"var(--amber)":"var(--m)"}}>{p}</button>
                  ))}
                </div>
                <button onClick={saveFormat} style={{background:"var(--amber)",color:"#000",border:"none",borderRadius:"5px",padding:"8px",cursor:"pointer",fontSize:"12px",fontWeight:"600"}}>save format</button>
              </div>
            )}
            <div style={{background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"8px",overflow:"hidden",marginBottom:"20px"}}>
              {formats.length===0&&!addingFormat&&<div style={{padding:"12px",fontSize:"11px",color:"var(--m)",fontStyle:"italic"}}>No formats yet.</div>}
              {formats.map((f,i)=>(
                <div key={f.id} style={{display:"flex",alignItems:"center",gap:"9px",padding:"9px 13px",borderBottom:i<formats.length-1?"1px solid var(--b)":"none"}} className="hr">
                  <Rocket size={12} color="var(--d)" strokeWidth={1.5}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:"12px"}}>{f.name}</div>
                    <div style={{fontSize:"9px",fontFamily:"var(--mono)",color:"var(--m)"}}>{f.source_folder} · {f.pick_count}/post · {JSON.parse(f.platforms).join(", ")}</div>
                  </div>
                  <button onClick={async()=>{await backendFetch(`/api/uploader/formats/${f.id}`,{method:"DELETE"});refresh()}} style={{background:"none",border:"none",cursor:"pointer",color:"var(--m)",padding:0}}><X size={11}/></button>
                </div>
              ))}
            </div>

            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px"}}>
              <Eyebrow>POST NOW</Eyebrow>
              {!wizard&&<button onClick={()=>setWizard({folder:"",platforms:[],step:0})} style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)",background:"var(--s2)",border:"1px solid var(--b)",borderRadius:"4px",padding:"3px 9px",cursor:"pointer"}}>start</button>}
            </div>
            {wizard&&(
              <div style={{background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"8px",padding:"13px",marginBottom:"20px",display:"flex",flexDirection:"column",gap:"10px"}} className="fi">
                <input value={wizard.folder} onChange={e=>setWizard(w=>({...w,folder:e.target.value}))} placeholder="Folder to upload from (never compressed)"
                  style={{background:"var(--s3)",color:"var(--t)",border:"1px solid var(--b)",borderRadius:"5px",padding:"7px 9px",fontSize:"12px"}}/>
                <div style={{display:"flex",gap:"5px",flexWrap:"wrap"}}>
                  {Object.keys(PLATFORM_SETTINGS).map(p=>{
                    const on=wizard.platforms.some(x=>x.platform===p)
                    const mapped=!!actionMap[p]
                    return <button key={p} onClick={()=>setWizard(w=>({...w,platforms:on?w.platforms.filter(x=>x.platform!==p):[...w.platforms,{platform:p,settings:{}}]}))}
                      style={{fontSize:"10px",fontFamily:"var(--mono)",padding:"4px 9px",borderRadius:"999px",border:"1px solid",cursor:"pointer",
                        borderColor:on?"var(--amber)":"var(--b)",background:on?"rgba(212,168,67,.1)":"transparent",color:on?"var(--amber)":"var(--m)"}}>
                      {p}{on&&!mapped?" ⚠":""}
                    </button>
                  })}
                </div>
                {wizard.platforms.filter(pl=>!actionMap[pl.platform]).length>0&&(
                  <div style={{fontSize:"9px",fontFamily:"var(--mono)",color:"var(--amber)"}}>⚠ platforms without a mapped action will queue but not send</div>
                )}
                {wizard.platforms.map((pl,pi)=>(
                  <div key={pl.platform} style={{background:"var(--s2)",borderRadius:"6px",padding:"10px"}}>
                    <Eyebrow style={{marginBottom:"7px"}}>{pl.platform.toUpperCase()}</Eyebrow>
                    <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
                      {PLATFORM_SETTINGS[pl.platform].map(fld=>(
                        <input key={fld.key} placeholder={fld.label}
                          onBlur={e=>setWizard(w=>({...w,platforms:w.platforms.map((x,i)=>i===pi?{...x,settings:{...x.settings,[fld.key]:e.target.value}}:x)}))}
                          style={{background:"var(--s3)",color:"var(--t)",border:"1px solid var(--b)",borderRadius:"4px",padding:"6px 8px",fontSize:"11px"}}/>
                      ))}
                    </div>
                  </div>
                ))}
                <div style={{display:"flex",gap:"8px"}}>
                  <button onClick={()=>setWizard(null)} style={{flex:1,background:"transparent",border:"1px solid var(--b)",color:"var(--d)",borderRadius:"5px",padding:"8px",cursor:"pointer",fontSize:"12px"}}>cancel</button>
                  <button onClick={queueBatch} disabled={!wizard.folder||!wizard.platforms.length}
                    style={{flex:1,background:"var(--amber)",color:"#000",border:"none",borderRadius:"5px",padding:"8px",cursor:"pointer",fontSize:"12px",fontWeight:"600",opacity:(!wizard.folder||!wizard.platforms.length)?.5:1}}>
                    queue &amp; post
                  </button>
                </div>
              </div>
            )}

            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px"}}>
              <Eyebrow>QUEUE</Eyebrow>
              <button onClick={runDrain} disabled={draining||!hasZapier}
                style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)",background:"var(--s2)",border:"1px solid var(--b)",borderRadius:"4px",padding:"3px 9px",cursor:draining?"default":"pointer",opacity:draining?.6:1}}>
                {draining?"sending…":"run queue now"}
              </button>
            </div>
            <div style={{background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"8px",overflow:"hidden"}}>
              {jobs.length===0&&<div style={{padding:"12px",fontSize:"11px",color:"var(--m)",fontStyle:"italic"}}>Nothing queued.</div>}
              {jobs.map((j,i)=>(
                <div key={j.id} style={{display:"flex",alignItems:"center",gap:"9px",padding:"8px 13px",borderBottom:i<jobs.length-1?"1px solid var(--b)":"none"}}>
                  <span style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)",width:"74px",flexShrink:0}}>{j.platform}</span>
                  <span style={{fontSize:"11px",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{j.payload?.folder||"—"}</span>
                  <span style={{fontSize:"9px",fontFamily:"var(--mono)",color:j.status==="done"?"var(--teal)":j.status==="failed"?"#e05555":"var(--amber)"}}>{STATUS_LABEL[j.status]||j.status}</span>
                  <button onClick={async()=>{await backendFetch(`/api/uploader/jobs/${j.id}`,{method:"DELETE"});refresh()}} style={{background:"none",border:"none",cursor:"pointer",color:"var(--m)",padding:0}}><X size={10}/></button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    )
  }

  function SettingsTab(){
    const [apiInput,setApiInput] = useState(apiBase)
    const [showAdvanced,setShowAdvanced] = useState(false)
    const OAUTH_SERVICES = [
      {service:"google_calendar", label:"Google Calendar", connect:()=>{window.location.href=apiBase+"/auth/google/start?scopes=calendar"}},
      {service:"gmail",           label:"Gmail",            connect:()=>{window.location.href=apiBase+"/auth/google/start?scopes=gmail"}},
      {service:"notion",          label:"Notion",           connect:()=>{window.location.href=apiBase+"/oauth/notion/start"}},
    ]
    const API_KEY_SERVICES = [
      {service:"canvas", label:"Canvas", fields:[{key:"domain",ph:"hw.instructure.com"},{key:"token",ph:"access token"}]},
      {service:"monday",  label:"monday.com", fields:[{key:"token",ph:"personal API token"}]},
      {service:"gemini",  label:"Gemini", fields:[{key:"token",ph:"AIza... (aistudio.google.com/apikey)"}]},
      {service:"ntfy",    label:"ntfy.sh", fields:[{key:"topic",ph:"your private topic name"}]},
      {service:"zapier", label:"Zapier",
        fields:[{key:"token", ph:"Paste your NLA API key here"}],
        hint:"Posts to TikTok, Instagram, YouTube, SoundCloud via Zapier — no app reviews needed.",
        links:[{label:"1. Get NLA key ↗", url:"https://zapier.com/l/natural-language-actions"}]},
    ]
    const credStatus = (svc)=>creds.find(c=>c.service===svc)
    const cf = credStatus("cloudflare")
    const deployed = !!me?.deployment?.worker_url || !!me?.operator_mode

    return (
      <div style={{overflowY:"auto",padding:"24px 28px",maxWidth:"640px"}} className="fi">

        {!apiBase ? (
          // Only ever seen if the shared backend genuinely isn't configured —
          // never a normal user's experience once DEFAULT_API_BASE is set.
          <div style={{fontSize:"12px",color:"var(--m)",fontStyle:"italic",marginBottom:"20px"}}>
            No backend configured yet — set DEFAULT_API_BASE, or open Advanced below to point at one manually.
          </div>
        ) : !me?.user ? (
          <div style={{background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"8px",padding:"32px 24px",textAlign:"center",marginBottom:"20px"}}>
            <div style={{fontSize:"13px",color:"var(--d)",marginBottom:"16px"}}>Welcome to LifeOS</div>
            <button onClick={()=>{window.location.href=apiBase+"/auth/google/start"}}
              style={{background:"var(--amber)",color:"#000",border:"none",borderRadius:"6px",padding:"10px 22px",cursor:"pointer",fontSize:"13px",fontWeight:"600"}}>
              Sign in with Google
            </button>
          </div>
        ):null}

        {/* Advanced — an override for anyone deliberately pointing at their
            own orchestrator deployment instead of the shared one. Not part
            of the normal path, so it stays collapsed by default. */}
        <details style={{marginBottom:me?.user?"24px":"8px"}} open={showAdvanced} onToggle={e=>setShowAdvanced(e.target.open)}>
          <summary style={{fontSize:"9px",fontFamily:"var(--mono)",color:"var(--m)",cursor:"pointer",listStyle:"none"}}>advanced</summary>
          <div style={{background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"8px",padding:"12px",marginTop:"8px"}}>
            <div style={{fontSize:"10px",color:"var(--d)",marginBottom:"7px"}}>Backend URL override</div>
            <div style={{display:"flex",gap:"8px"}}>
              <input value={apiInput} onChange={e=>setApiInput(e.target.value)} placeholder="https://lifeos-api.you.workers.dev"
                style={{flex:1,background:"var(--s3)",color:"var(--t)",border:"1px solid var(--b)",borderRadius:"5px",padding:"6px 9px",fontSize:"11px",fontFamily:"var(--mono)"}}/>
              <button onClick={()=>saveApiBase(apiInput)}
                style={{background:"var(--s2)",color:"var(--d)",border:"1px solid var(--b)",borderRadius:"5px",padding:"6px 12px",cursor:"pointer",fontSize:"11px"}}>
                save
              </button>
            </div>
          </div>
        </details>

        {me?.user&&(
          <>
            {/* Account */}
            <div style={{marginBottom:"24px"}}>
              <Eyebrow style={{marginBottom:"10px"}}>ACCOUNT</Eyebrow>
              <div style={{background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"8px",padding:"12px 14px",
                display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div>
                  <div style={{fontSize:"12px"}}>{me.user.name||me.user.email}</div>
                  <div style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)"}}>{me.user.email}</div>
                </div>
                <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
                  <button onClick={async()=>{await fetch(apiBase+"/auth/logout",{method:"POST",credentials:"include"});setMe(null)}}
                    style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)",background:"none",border:"1px solid var(--b)",borderRadius:"4px",padding:"5px 10px",cursor:"pointer"}}>
                    sign out
                  </button>
                  <button onClick={async()=>{
                      if(!confirm("Delete your LifeOS account? This removes your account, encrypted credentials, config, and queued jobs from LifeOS permanently."))return
                      if(!confirm("Are you sure? This cannot be undone."))return
                      await fetch(apiBase+"/api/account",{method:"DELETE",credentials:"include"}).catch(()=>{})
                      if(me?.deployment?.worker_url) alert("Done. Your own Cloudflare Worker and database are in YOUR account — delete them from your Cloudflare dashboard whenever you like (Workers & Pages, and D1).")
                      setMe(null)
                    }}
                    style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--red)",background:"none",border:"1px solid var(--b)",borderRadius:"4px",padding:"5px 10px",cursor:"pointer"}}>
                    delete account
                  </button>
                </div>
              </div>
            </div>

            {/* Your own infrastructure — Cloudflare BYOC (required for everyone) */}
            <div style={{marginBottom:"24px"}}>
              <Eyebrow style={{marginBottom:"10px"}}>YOUR INFRASTRUCTURE{!deployed&&" — REQUIRED"}</Eyebrow>
              <div style={{background:"var(--s1)",border:deployed?"1px solid var(--b)":"1px solid rgba(212,168,67,.4)",borderRadius:"8px",padding:"14px"}}>
                {me?.operator_mode?(
                  <>
                    <div style={{fontSize:"12px",color:"var(--teal)",marginBottom:"5px"}}>✓ Operator mode — running on the shared backend</div>
                    <div style={{fontSize:"10px",color:"var(--m)"}}>You're using LifeOS's own deployment directly. Other users will each connect their own Cloudflare account.</div>
                  </>
                ):deployed?(
                  <>
                    <div style={{fontSize:"12px",color:"var(--teal)",marginBottom:"5px"}}>✓ Running on your own Cloudflare account</div>
                    <div style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)"}}>{me.deployment.worker_url}</div>
                    <div style={{fontSize:"10px",color:"var(--m)",marginTop:"6px"}}>Your data, credentials, and automations live in your account — not on shared servers.</div>
                  </>
                ):!cf?(
                  <>
                    <div style={{fontSize:"11px",color:"var(--d)",marginBottom:"10px",lineHeight:"1.6"}}>
                      LifeOS runs entirely on <b>your own</b> Cloudflare account — your data and credentials
                      never live on shared infrastructure. Connecting takes one click and a free Cloudflare
                      account; deployment after that is automatic (~30 seconds). Everything else unlocks after this step.
                    </div>
                    <button onClick={()=>{window.location.href=apiBase+"/oauth/cloudflare/start"}}
                      style={{fontSize:"11px",fontFamily:"var(--mono)",color:"#000",background:"var(--amber)",border:"none",borderRadius:"5px",padding:"8px 14px",cursor:"pointer",fontWeight:"600"}}>
                      Connect Cloudflare — step 1 of 2
                    </button>
                  </>
                ):(
                  <>
                    <div style={{fontSize:"12px",color:"var(--teal)",marginBottom:"10px"}}>✓ Cloudflare connected</div>
                    <button disabled={settingsBusy} onClick={provisionNow}
                      style={{fontSize:"11px",fontFamily:"var(--mono)",color:"#000",background:"var(--amber)",border:"none",borderRadius:"5px",padding:"8px 14px",cursor:settingsBusy?"default":"pointer",opacity:settingsBusy?.6:1,fontWeight:"600"}}>
                      {settingsBusy?"Deploying...":"Deploy my LifeOS backend — step 2 of 2"}
                    </button>
                  </>
                )}
                {settingsMsg&&<div style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)",marginTop:"8px"}}>{settingsMsg}</div>}
              </div>
            </div>

            {/* Connected services — unlocked once the user's own backend exists */}
            {deployed?(<>
            <div style={{marginBottom:"24px"}}>
              <Eyebrow style={{marginBottom:"10px"}}>CONNECTED SERVICES</Eyebrow>
              <div style={{background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"8px",overflow:"hidden"}}>
                {OAUTH_SERVICES.map((s,i)=>{
                  const c = credStatus(s.service)
                  return (
                    <div key={s.service} style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                      padding:"10px 14px",borderBottom:i<OAUTH_SERVICES.length-1||API_KEY_SERVICES.length?"1px solid var(--b)":"none"}}>
                      <span style={{fontSize:"12px"}}>{s.label}</span>
                      {c?(
                        <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                          <span style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--teal)"}}>✓ connected</span>
                          <button onClick={()=>disconnectService(s.service)} style={{background:"none",border:"none",cursor:"pointer",color:"var(--d)",padding:0}}><X size={12}/></button>
                        </div>
                      ):(
                        <button onClick={s.connect}
                          style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)",background:"var(--s2)",border:"1px solid var(--b)",borderRadius:"4px",padding:"4px 10px",cursor:"pointer"}}>
                          connect
                        </button>
                      )}
                    </div>
                  )
                })}
                {API_KEY_SERVICES.map((s,i)=>{
                  const c = credStatus(s.service)
                  return (
                    <ApiKeyRow key={s.service} spec={s} connected={!!c}
                      onSave={payload=>saveApiKeyCred(s.service,payload)}
                      onDisconnect={()=>disconnectService(s.service)}
                      isLast={i===API_KEY_SERVICES.length-1}/>
                  )
                })}
              </div>
            </div>

            {/* Config — non-secret pointers, only worth showing once the relevant service is connected */}
            {(credStatus("notion")||credStatus("monday"))&&(
              <div style={{marginBottom:"24px"}}>
                <Eyebrow style={{marginBottom:"10px"}}>CONFIGURATION</Eyebrow>
                <div style={{background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"8px",overflow:"hidden"}}>
                  {[
                    ...(credStatus("notion")?[
                      {key:"notion.projects_db_id", label:"Notion — Projects database ID"},
                      {key:"notion.calendar_db_id", label:"Notion — Calendar database ID"},
                    ]:[]),
                    ...(credStatus("monday")?[
                      {key:"monday.deadlines_board_id", label:"monday — Deadlines board ID"},
                      {key:"monday.rules_board_id", label:"monday — Reminder Rules board ID"},
                    ]:[]),
                  ].map((row,i,arr)=>(
                    <div key={row.key} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"10px",
                      padding:"9px 14px",borderBottom:i<arr.length-1?"1px solid var(--b)":"none"}}>
                      <span style={{fontSize:"11px",color:"var(--d)"}}>{row.label}</span>
                      <input defaultValue={cfg[row.key]||""} placeholder="paste ID"
                        onBlur={e=>saveConfigKey(row.key,e.target.value)}
                        style={{width:"180px",background:"var(--s3)",color:"var(--t)",border:"1px solid var(--b)",borderRadius:"4px",padding:"4px 7px",fontSize:"11px",fontFamily:"var(--mono)"}}/>
                    </div>
                  ))}
                </div>
              </div>
            )}
            </>):(
              <div style={{fontSize:"11px",color:"var(--m)",fontStyle:"italic"}}>
                Services (Notion, Gmail, Calendar, Canvas, Gemini…) unlock once your backend is deployed above.
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  // ─── Layout ───────────────────────────────────────────────────────────────
  const views={
    dashboard:<Dashboard/>,
    projects:<Projects/>,
    files:<Files/>,
    calendar:<CalendarView/>,
    digest:<DigestView/>,
    uploader:<UploaderTab/>,
    settings:<SettingsTab/>,
  }

  return(
    <>
      <style>{CSS}</style>
      <div style={{display:"flex",height:"100vh",background:"var(--bg)",fontFamily:"var(--sans)",color:"var(--t)",fontSize:"14px"}}>

        {/* Sidebar */}
        <div style={{width:"52px",borderRight:"1px solid var(--b)",display:"flex",flexDirection:"column",alignItems:"center",
          paddingTop:"14px",paddingBottom:"14px",gap:"2px",flexShrink:0}}>
          <div style={{width:"28px",height:"28px",marginBottom:"12px",display:"flex",alignItems:"center",justifyContent:"center",
            borderRadius:"6px",background:"rgba(212,168,67,.12)"}}>
            <Layers size={14} color="var(--amber)" strokeWidth={1.5}/>
          </div>
          {NAV_ITEMS.map(({id,Icon,label})=>{
            const active=tab===id
            return(
              <button key={id} onClick={()=>setTab(id)} title={label}
                style={{width:"38px",height:"38px",display:"flex",alignItems:"center",justifyContent:"center",
                  border:"none",cursor:"pointer",borderRadius:"6px",transition:"all .1s",
                  background:active?"rgba(212,168,67,.1)":"transparent",
                  color:active?"var(--amber)":"var(--m)"}}>
                <Icon size={15} strokeWidth={active?2:1.5}/>
              </button>
            )
          })}
          <div style={{flex:1}}/>
        </div>

        {/* Main */}
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0}}>

          {/* Command bar */}
          <div style={{padding:"9px 14px",borderBottom:"1px solid var(--b)",flexShrink:0}}>
            <form onSubmit={runCmd}>
              <div style={{position:"relative"}}>
                <input ref={cmdRef} value={cmd} onChange={e=>setCmd(e.target.value)}
                  onFocus={()=>setFocused(true)} onBlur={()=>setFocused(false)}
                  placeholder={busy?"...":"ask — add project, track file, set task, set reminder — anything"}
                  disabled={busy}
                  style={{width:"100%",background:"var(--s1)",color:"var(--t)",border:"1px solid transparent",
                    borderRadius:"7px",padding:"9px 90px 9px 13px",fontSize:"12px",fontFamily:"var(--mono)",outline:"none"}}
                  className={(focused||cmd)?"cmd-live":"cmd-idle"}/>
                <button type="submit" disabled={busy||!cmd.trim()}
                  style={{position:"absolute",right:"7px",top:"50%",transform:"translateY(-50%)",
                    background:cmd.trim()&&!busy?"var(--amber)":"var(--s3)",
                    color:cmd.trim()&&!busy?"#000":"var(--m)",
                    border:"none",borderRadius:"5px",padding:"5px 12px",fontSize:"10px",fontFamily:"var(--mono)",
                    cursor:cmd.trim()&&!busy?"pointer":"default",transition:"all .15s",letterSpacing:".04em"}}>
                  {busy?<span className="processing"><span>···</span></span>:"RUN"}
                </button>
              </div>
            </form>
            {result&&(
              <div style={{marginTop:"5px",padding:"6px 11px",background:"var(--s2)",borderRadius:"5px",
                fontSize:"11px",fontFamily:"var(--mono)",
                color:result.type==="err"?"var(--red)":result.type==="warn"?"var(--amber)":"var(--d)"}}
                className="r-in">
                {result.text}
              </div>
            )}
          </div>

          {/* Content */}
          <div style={{flex:1,overflow:"hidden"}} key={tab}>
            {views[tab]}
          </div>
        </div>
      </div>

      {addFileFor!==null&&<AddFileModal/>}
      {addProjOpen&&<AddProjectModal/>}
      {scrapeResult&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200}} onClick={()=>setScrapeResult(null)}>
          <div onClick={e=>e.stopPropagation()} style={{background:"var(--s1)",border:"1px solid var(--b)",borderRadius:"10px",padding:"20px",width:"480px",maxHeight:"80vh",overflowY:"auto"}} className="fi">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"12px"}}>
              <div style={{minWidth:0}}>
                <Eyebrow style={{marginBottom:"3px"}}>RESEARCH RESULT</Eyebrow>
                <div style={{fontSize:"10px",fontFamily:"var(--mono)",color:"var(--d)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{scrapeResult.url}</div>
              </div>
              <button onClick={()=>setScrapeResult(null)} style={{background:"none",border:"none",cursor:"pointer",color:"var(--m)",padding:"2px",flexShrink:0}}><X size={14}/></button>
            </div>
            <div style={{fontSize:"11px",color:"var(--amber)",marginBottom:"10px"}}>{scrapeResult.goal}</div>
            <div style={{fontSize:"13px",lineHeight:"1.65",whiteSpace:"pre-wrap"}}>{scrapeResult.answer}</div>
          </div>
        </div>
      )}
    </>
  )
}
