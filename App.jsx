import React, { useState, useRef, useEffect } from "react";
import { Upload, Shield, CheckCircle2, XCircle, AlertCircle, Download, FileSpreadsheet, Loader2, ExternalLink, Activity, Zap, Globe, Lock, Search, User, X, ArrowRight, BookmarkPlus, Bookmark, Trash2, Database, RefreshCw, FileText } from "lucide-react";

// ============================================================
// Vendor Certification Scanner
// LIVE API MODE: direct calls to Anthropic API with web search
// ============================================================

const BRAND = {
  bg: "#ffffff",
  bgAlt: "#f7f6f4",
  bgPanel: "#fafaf9",
  ink: "#1a1a1a",
  inkSoft: "#4a4a4a",
  inkMuted: "#8a8a8a",
  border: "#e5e3df",
  borderStrong: "#cfcdc7",
  red: "#E02428",
  redDark: "#b81d20",
  redSoft: "#fdecec",
  success: "#1e7a3b",
  warn: "#b8730d",
};

const CERTS_TO_SCAN = ["SOC 2", "ISO 27001"];

const loadSheetJS = () =>
  new Promise((resolve, reject) => {
    if (window.XLSX) return resolve(window.XLSX);
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload = () => resolve(window.XLSX);
    s.onerror = reject;
    document.head.appendChild(s);
  });

const STATUS_META = {
  verified: { label: "VERIFIED", color: BRAND.success, Icon: CheckCircle2 },
  claimed: { label: "CLAIMED", color: BRAND.warn, Icon: AlertCircle },
  not_found: { label: "NOT FOUND", color: BRAND.inkMuted, Icon: XCircle },
  expired: { label: "EXPIRED", color: BRAND.red, Icon: XCircle },
  scanning: { label: "SCANNING", color: BRAND.red, Icon: Loader2 },
  pending: { label: "QUEUED", color: BRAND.inkMuted, Icon: Activity },
  error: { label: "ERROR", color: BRAND.red, Icon: XCircle },
};

// ============================================================
// LIVE API CALL with web search
// ============================================================
const SYSTEM_PROMPT = `You are a compliance researcher. Given a vendor name, research and report on their SOC 2 and ISO 27001 certifications.

You MUST respond ONLY with a valid JSON object (no markdown, no backticks, no preamble). Schema:
{
  "vendor": "Official Company Name",
  "summary": "one sentence on overall compliance posture",
  "trust_center_url": "https://... (deepest link to trust portal) or null",
  "certifications": [
    {
      "name": "SOC 2",
      "status": "verified" | "claimed" | "not_found" | "expired",
      "type": "Type I" | "Type II" | null,
      "evidence": "what you found",
      "source_url": "https://... (deepest link to access/request this cert) or null",
      "publicly_accessible": true or false
    },
    {
      "name": "ISO 27001",
      "status": "verified" | "claimed" | "not_found" | "expired",
      "type": null,
      "evidence": "what you found",
      "source_url": "https://... (deepest link to access/request this cert) or null",
      "publicly_accessible": true or false,
      "soa": {
        "availability": "bundled" | "on_request" | "customer_only" | "not_found",
        "access_notes": "one sentence on how to obtain it",
        "soa_url": "https://... or null"
      }
    }
  ]
}

CRITICAL — URLs must be the DEEPEST POSSIBLE LINK. Priority order:
1. Direct download URL for cert/report (PDF, SafeBase/Vanta/Drata trust portal)
2. The specific request-access page
3. Only as last resort, a general security/trust page

CRITICAL — Statement of Applicability (SoA) for ISO 27001: The SoA lists which Annex A controls the vendor implemented vs excluded with justification — essential for vendor due diligence and more important than the certificate itself.

Status definitions:
- verified: third-party verifiable via trust portal, certification body, or audit report listing
- claimed: vendor states they have it but no third-party verification found
- not_found: no evidence found
- expired: evidence shows certification has lapsed

SoA availability:
- bundled: SoA provided alongside cert at same URL/portal
- on_request: must be requested separately from cert
- customer_only: only available to current customers behind login
- not_found: no evidence vendor provides SoA externally

publicly_accessible: true if report/cert can be viewed/downloaded without NDA or sales contact; false if gated.

Be thorough — check trust portals, certification body listings, AWS Artifact mentions, and third-party verification platforms. Return the complete JSON before stopping.`;

async function scanVendorLive(vendorName) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      temperature: 0,
      system: SYSTEM_PROMPT,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: `Research SOC 2 and ISO 27001 certifications for: "${vendorName.trim()}". Find their trust center and the deepest possible links for each cert.` }],
    }),
  });

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e?.error?.message || `API error ${res.status}`);
  }

  const data = await res.json();
  const text = data.content?.filter(b => b.type === "text").map(b => b.text).join("\n") || "";
  const match = text.replace(/```json\s*/g, "").replace(/```/g, "").match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Could not parse response.");
  return JSON.parse(match[0]);
}

// ============================================================
export default function App() {
  const [view, setView] = useState("scanner");
  const [vendors, setVendors] = useState([]);
  const [savedVendors, setSavedVendors] = useState([]);
  const [savedLoading, setSavedLoading] = useState(true);
  const [fileName, setFileName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [mode, setMode] = useState("single");
  const [singleVendorInput, setSingleVendorInput] = useState("");
  const [savedFilter, setSavedFilter] = useState("");
  const fileInputRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        if (window.storage) {
          const list = await window.storage.list("vendor:");
          if (list && list.keys && list.keys.length) {
            const records = [];
            for (const key of list.keys) {
              try {
                const result = await window.storage.get(key);
                if (result && result.value) records.push(JSON.parse(result.value));
              } catch (e) {}
            }
            records.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
            setSavedVendors(records);
          }
        }
      } catch (e) {
        console.error(e);
      } finally {
        setSavedLoading(false);
      }
    })();
  }, []);

  const saveVendor = async (vendor) => {
    if (!vendor.results) return;
    const record = {
      vendor: vendor.name,
      results: vendor.results,
      savedAt: new Date().toISOString(),
    };
    const key = `vendor:${vendor.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
    try {
      if (window.storage) await window.storage.set(key, JSON.stringify(record));
      setSavedVendors((prev) => {
        const filtered = prev.filter((v) => v.vendor.toLowerCase() !== vendor.name.toLowerCase());
        return [record, ...filtered];
      });
    } catch (e) {
      alert("Could not save: " + e.message);
    }
  };

  const deleteSaved = async (vendorName) => {
    const key = `vendor:${vendorName.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
    try {
      if (window.storage) await window.storage.delete(key);
      setSavedVendors((prev) => prev.filter((v) => v.vendor.toLowerCase() !== vendorName.toLowerCase()));
    } catch (e) {
      alert("Could not delete: " + e.message);
    }
  };

  const isVendorSaved = (vendorName) =>
    savedVendors.some((v) => v.vendor.toLowerCase() === vendorName.toLowerCase());

  const handleFile = async (file) => {
    if (!file) return;
    setFileName(file.name);
    try {
      const XLSX = await loadSheetJS();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
      const headerKeywords = ["vendor", "company", "name", "supplier", "organization"];
      let names = rows.map((r) => (r[0] != null ? String(r[0]).trim() : "")).filter(Boolean);
      if (names.length && headerKeywords.some((k) => names[0].toLowerCase().includes(k))) {
        names = names.slice(1);
      }
      names = [...new Set(names)].slice(0, 25);
      setVendors(names.map((n) => ({ name: n, status: "pending", results: null, error: null })));
      setProgress({ done: 0, total: names.length });
    } catch (e) {
      alert("Could not parse file: " + e.message);
    }
  };

  const onFileInput = (e) => handleFile(e.target.files?.[0]);
  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  const runScan = async (vendorList) => {
    setScanning(true);
    setProgress({ done: 0, total: vendorList.length });

    for (let i = 0; i < vendorList.length; i++) {
      const targetName = vendorList[i].name;
      setVendors((prev) => prev.map((v) => v.name === targetName ? { ...v, status: "scanning" } : v));
      try {
        const result = await scanVendorLive(targetName);
        setVendors((prev) => prev.map((v) => {
          if (v.name === targetName) {
            const updated = { ...v, status: "done", results: result };
            saveVendor(updated);
            return updated;
          }
          return v;
        }));
      } catch (err) {
        setVendors((prev) => prev.map((v) => v.name === targetName ? { ...v, status: "error", error: err.message } : v));
      }
      setProgress((p) => ({ ...p, done: i + 1 }));
    }
    setScanning(false);
  };

  const startBulkScan = () => {
    if (!vendors.length) return;
    runScan(vendors);
  };

  const scanSingleVendor = () => {
    const name = singleVendorInput.trim();
    if (!name) return;
    setFileName(`Single vendor: ${name}`);
    const newList = [{ name, status: "pending", results: null, error: null }];
    setVendors(newList);
    setSingleVendorInput("");
    runScan(newList);
  };

  const exportCSV = () => {
    const header = ["Vendor", "Trust Center", "SOC 2 Status", "SOC 2 Type", "SOC 2 Public", "SOC 2 Evidence", "SOC 2 Source", "ISO 27001 Status", "ISO 27001 Public", "ISO 27001 Evidence", "ISO 27001 Source", "SoA Availability", "SoA Notes", "SoA URL", "Summary"];
    const rows = vendors.map((v) => {
      const soc = v.results?.certifications?.find((c) => c.name === "SOC 2");
      const iso = v.results?.certifications?.find((c) => c.name === "ISO 27001");
      return [
        v.name, v.results?.trust_center_url || "",
        soc?.status || "n/a", soc?.type || "", soc?.publicly_accessible ? "Yes" : "No", soc?.evidence || "", soc?.source_url || "",
        iso?.status || "n/a", iso?.publicly_accessible ? "Yes" : "No", iso?.evidence || "", iso?.source_url || "",
        iso?.soa?.availability || "", iso?.soa?.access_notes || "", iso?.soa?.soa_url || "",
        v.results?.summary || "",
      ];
    });
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cert-scan-results.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setVendors([]);
    setFileName("");
    setProgress({ done: 0, total: 0 });
  };

  const loadSample = () => {
    const samples = ["Stripe", "Slack", "Notion", "Datadog", "Snowflake"];
    setFileName("sample-vendors.xlsx");
    setVendors(samples.map((n) => ({ name: n, status: "pending", results: null, error: null })));
    setProgress({ done: 0, total: samples.length });
  };

  const stats = vendors.reduce((acc, v) => {
    if (v.results?.certifications) {
      for (const c of v.results.certifications) {
        if (c.status === "verified") acc.verified++;
        else if (c.status === "claimed") acc.claimed++;
        else if (c.status === "not_found") acc.notFound++;
        else if (c.status === "expired") acc.expired++;
      }
    }
    return acc;
  }, { verified: 0, claimed: 0, notFound: 0, expired: 0 });

  const totalScanned = stats.verified + stats.claimed + stats.notFound + stats.expired;

  return (
    <div className="min-h-screen w-full" style={{ background: BRAND.bg, color: BRAND.ink, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <header className="border-b" style={{ borderColor: BRAND.border, background: BRAND.bg }}>
        <div className="max-w-7xl mx-auto px-8 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 flex items-center justify-center" style={{ background: BRAND.red }}>
              <Shield size={18} style={{ color: "#fff" }} strokeWidth={2.5} />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold tracking-tight" style={{ color: BRAND.ink }}>CertScanner</span>
              <span className="text-sm" style={{ color: BRAND.inkSoft }}>Vendor Certification Intelligence</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <nav className="flex items-center gap-1 mr-2">
              <button onClick={() => setView("scanner")} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-all"
                style={{ background: view === "scanner" ? BRAND.ink : "transparent", color: view === "scanner" ? "#fff" : BRAND.inkSoft, border: `1px solid ${view === "scanner" ? BRAND.ink : BRAND.border}` }}>
                <Search size={14} /> Scanner
              </button>
              <button onClick={() => setView("saved")} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-all"
                style={{ background: view === "saved" ? BRAND.ink : "transparent", color: view === "saved" ? "#fff" : BRAND.inkSoft, border: `1px solid ${view === "saved" ? BRAND.ink : BRAND.border}` }}>
                <Database size={14} /> Saved
                {savedVendors.length > 0 && (
                  <span className="text-xs px-1.5 py-0.5 font-mono" style={{ background: view === "saved" ? BRAND.red : BRAND.bgPanel, color: view === "saved" ? "#fff" : BRAND.ink }}>
                    {savedVendors.length}
                  </span>
                )}
              </button>
            </nav>
            <div className="hidden md:flex items-center gap-2 text-xs px-3 py-1.5" style={{ color: BRAND.success, border: `1px solid ${BRAND.border}` }}>
              <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: BRAND.success }} />
              Live research
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-8 py-12">
        {view === "scanner" && (<>
          <div className="mb-10 max-w-3xl">
            <div className="text-xs font-semibold mb-4" style={{ color: BRAND.red, letterSpacing: "0.15em" }}>SUPPLY CHAIN INTELLIGENCE</div>
            <h1 className="text-5xl md:text-6xl font-bold tracking-tight leading-[1.05] mb-5" style={{ color: BRAND.ink }}>
              Instant vendor <span style={{ color: BRAND.red }}>certification</span> visibility.
            </h1>
            <p className="text-lg leading-relaxed" style={{ color: BRAND.inkSoft }}>
              Scan a single vendor or upload a list. Verify SOC 2 and ISO 27001 status against trust centers, certification registries, and security disclosures — automatically, via live web research.
            </p>
          </div>

          {!vendors.length && (
            <>
              <div className="flex gap-0">
                <button onClick={() => setMode("single")} className="flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-all"
                  style={{ background: mode === "single" ? BRAND.bg : "transparent", color: mode === "single" ? BRAND.ink : BRAND.inkMuted, border: `1px solid ${BRAND.border}`, borderBottom: mode === "single" ? `1px solid ${BRAND.bg}` : `1px solid ${BRAND.border}` }}>
                  <User size={15} /> Single Vendor
                </button>
                <button onClick={() => setMode("bulk")} className="flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-all"
                  style={{ background: mode === "bulk" ? BRAND.bg : "transparent", color: mode === "bulk" ? BRAND.ink : BRAND.inkMuted, border: `1px solid ${BRAND.border}`, borderLeft: "none", borderBottom: mode === "bulk" ? `1px solid ${BRAND.bg}` : `1px solid ${BRAND.border}` }}>
                  <FileSpreadsheet size={15} /> Bulk Upload
                </button>
                <div className="flex-1 border-b" style={{ borderColor: BRAND.border }} />
              </div>

              {mode === "single" ? (
                <div style={{ border: `1px solid ${BRAND.border}`, borderTop: "none", background: BRAND.bgPanel, padding: "60px 40px" }}>
                  <div className="max-w-xl mx-auto">
                    <div className="flex flex-col items-center text-center mb-8">
                      <div className="w-14 h-14 mb-5 flex items-center justify-center" style={{ background: BRAND.redSoft }}>
                        <Search size={24} style={{ color: BRAND.red }} strokeWidth={2} />
                      </div>
                      <h2 className="text-2xl font-bold mb-2" style={{ color: BRAND.ink }}>Scan a single vendor</h2>
                      <p className="text-sm" style={{ color: BRAND.inkSoft }}>Enter a company name to verify their certifications.</p>
                    </div>
                    <div className="flex gap-0" style={{ border: `1px solid ${BRAND.borderStrong}`, background: BRAND.bg }}>
                      <input type="text" value={singleVendorInput} onChange={(e) => setSingleVendorInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && scanSingleVendor()}
                        placeholder="e.g. Stripe, AWS, Snowflake..." autoFocus className="flex-1 px-5 py-4 text-base outline-none bg-transparent" style={{ color: BRAND.ink }} />
                      <button onClick={scanSingleVendor} disabled={!singleVendorInput.trim() || scanning} className="flex items-center gap-2 px-6 text-sm font-semibold transition-all hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed" style={{ background: BRAND.red, color: "#fff" }}>
                        Scan <ArrowRight size={15} />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-4 justify-center items-center">
                      <span className="text-xs" style={{ color: BRAND.inkMuted }}>Try:</span>
                      {["Stripe", "Cloudflare", "GitHub", "Okta"].map((name) => (
                        <button key={name} onClick={() => setSingleVendorInput(name)} className="text-xs px-3 py-1 transition-all hover:brightness-95" style={{ color: BRAND.red, border: `1px solid ${BRAND.border}`, background: BRAND.bg }}>
                          {name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop} onClick={() => fileInputRef.current?.click()} className="cursor-pointer transition-all"
                    style={{ border: `1px dashed ${dragOver ? BRAND.red : BRAND.borderStrong}`, borderTop: "none", background: dragOver ? BRAND.redSoft : BRAND.bgPanel, padding: "80px 40px" }}>
                    <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFileInput} className="hidden" />
                    <div className="flex flex-col items-center text-center">
                      <div className="w-14 h-14 mb-5 flex items-center justify-center" style={{ background: BRAND.redSoft }}>
                        <Upload size={24} style={{ color: BRAND.red }} strokeWidth={2} />
                      </div>
                      <h2 className="text-2xl font-bold mb-2" style={{ color: BRAND.ink }}>Drop your vendor list</h2>
                      <p className="text-sm mb-1" style={{ color: BRAND.inkSoft }}>.xlsx, .xls, or .csv — vendor names in the first column</p>
                      <div className="text-xs mt-4 px-3 py-1" style={{ color: BRAND.inkMuted, border: `1px solid ${BRAND.border}` }}>Max 25 vendors per scan</div>
                    </div>
                  </div>
                  <div className="mt-4 text-center">
                    <button onClick={loadSample} className="text-sm hover:underline" style={{ color: BRAND.red }}>or load 5 sample vendors →</button>
                  </div>
                </>
              )}
            </>
          )}

          {vendors.length > 0 && (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4 p-4" style={{ background: BRAND.bgPanel, border: `1px solid ${BRAND.border}` }}>
              <div className="flex items-center gap-4">
                <FileSpreadsheet size={18} style={{ color: BRAND.red }} />
                <div>
                  <div className="text-sm font-semibold" style={{ color: BRAND.ink }}>{fileName}</div>
                  <div className="text-xs" style={{ color: BRAND.inkMuted }}>{vendors.length} vendors loaded</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {scanning && (
                  <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: BRAND.red }}>
                    <Loader2 size={14} className="animate-spin" /> Scanning {progress.done}/{progress.total}
                  </div>
                )}
                {progress.done > 0 && !scanning && (
                  <button onClick={exportCSV} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-colors hover:brightness-95" style={{ background: BRAND.ink, color: "#fff" }}>
                    <Download size={14} /> Export CSV
                  </button>
                )}
                <button onClick={reset} disabled={scanning} className="px-4 py-2 text-sm transition-colors hover:bg-black/5 disabled:opacity-30" style={{ border: `1px solid ${BRAND.border}`, color: BRAND.ink }}>Reset</button>
                {!scanning && progress.done < progress.total && (
                  <button onClick={startBulkScan} className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold transition-all hover:brightness-110" style={{ background: BRAND.red, color: "#fff" }}>
                    <Zap size={14} fill="#fff" />
                    {progress.done > 0 ? "Resume scan" : "Initiate scan"}
                  </button>
                )}
              </div>
            </div>
          )}

          {(scanning || progress.done > 0) && progress.total > 0 && (
            <div className="mb-6">
              <div className="h-1 w-full overflow-hidden" style={{ background: BRAND.border }}>
                <div className="h-full transition-all duration-500" style={{ width: `${(progress.done / progress.total) * 100}%`, background: `linear-gradient(90deg, ${BRAND.redDark}, ${BRAND.red})` }} />
              </div>
            </div>
          )}

          {totalScanned > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
              {[
                { label: "Verified", val: stats.verified, color: BRAND.success },
                { label: "Claimed", val: stats.claimed, color: BRAND.warn },
                { label: "Not Found", val: stats.notFound, color: BRAND.inkMuted },
                { label: "Expired", val: stats.expired, color: BRAND.red },
              ].map((s) => (
                <div key={s.label} className="p-4 border" style={{ background: BRAND.bg, borderColor: BRAND.border }}>
                  <div className="text-xs font-semibold mb-2" style={{ color: BRAND.inkMuted, letterSpacing: "0.1em", textTransform: "uppercase" }}>{s.label}</div>
                  <div className="flex items-baseline gap-2">
                    <div className="text-3xl font-bold" style={{ color: s.color }}>{s.val}</div>
                    <div className="text-xs" style={{ color: BRAND.inkMuted }}>/ {vendors.length * CERTS_TO_SCAN.length}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {vendors.length > 0 && (
            <div className="space-y-2">
              <div className="grid grid-cols-12 gap-4 px-4 py-2 text-xs font-semibold" style={{ color: BRAND.inkMuted, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                <div className="col-span-1">#</div>
                <div className="col-span-3">Vendor</div>
                <div className="col-span-3">SOC 2</div>
                <div className="col-span-3">ISO 27001</div>
                <div className="col-span-2 text-right">Access</div>
              </div>
              {vendors.map((v, i) => (
                <VendorRow key={i} index={i + 1} vendor={v} isSaved={isVendorSaved(v.name)} onSave={() => saveVendor(v)} />
              ))}
            </div>
          )}
        </>)}

        {view === "saved" && (
          <SavedView savedVendors={savedVendors} loading={savedLoading} filter={savedFilter} setFilter={setSavedFilter} onDelete={deleteSaved}
            onReScan={(name) => {
              setView("scanner");
              setMode("single");
              setSingleVendorInput(name);
            }} />
        )}
      </main>
    </div>
  );
}

// ============================================================
function VendorRow({ index, vendor, isSaved, onSave }) {
  const [expanded, setExpanded] = useState(false);

  const renderCertCell = (certName) => {
    if (vendor.status === "scanning") {
      return (
        <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: BRAND.red }}>
          <div className="relative w-2.5 h-2.5">
            <div className="absolute inset-0 rounded-full animate-ping" style={{ background: BRAND.red, opacity: 0.4 }} />
            <div className="absolute inset-0 rounded-full" style={{ background: BRAND.red }} />
          </div>
          SCANNING
        </div>
      );
    }
    if (vendor.status === "pending") return <div className="text-xs" style={{ color: BRAND.inkMuted }}>—</div>;
    if (vendor.status === "error") return <div className="text-xs font-semibold" style={{ color: BRAND.red }}>FAILED</div>;
    const cert = vendor.results?.certifications?.find((c) => c.name === certName);
    if (!cert) return <div className="text-xs" style={{ color: BRAND.inkMuted }}>—</div>;
    const cmeta = STATUS_META[cert.status] || STATUS_META.not_found;
    const CIcon = cmeta.Icon;
    return (
      <div className="flex items-center gap-2">
        <CIcon size={14} style={{ color: cmeta.color }} />
        <span className="text-xs font-semibold" style={{ color: cmeta.color, letterSpacing: "0.05em" }}>{cmeta.label}</span>
        {cert.type && <span className="text-[10px] font-semibold px-1.5 py-0.5" style={{ background: BRAND.bgPanel, color: BRAND.inkSoft, border: `1px solid ${BRAND.border}` }}>{cert.type}</span>}
      </div>
    );
  };

  const isClickable = vendor.status === "done" || vendor.status === "error";
  const certs = vendor.results?.certifications || [];
  const anyPublic = certs.some((c) => c.publicly_accessible);
  const anyGated = certs.some((c) => c.publicly_accessible === false);

  return (
    <div onClick={() => isClickable && setExpanded(!expanded)} className={`transition-all ${isClickable ? "cursor-pointer hover:bg-black/[0.02]" : ""}`}
      style={{ background: BRAND.bg, border: `1px solid ${vendor.status === "scanning" ? BRAND.red : BRAND.border}`, borderLeftWidth: vendor.status === "scanning" ? "3px" : "1px" }}>
      <div className="grid grid-cols-12 gap-4 px-4 py-4 items-center">
        <div className="col-span-1 text-xs font-mono" style={{ color: BRAND.inkMuted }}>{String(index).padStart(3, "0")}</div>
        <div className="col-span-3 font-semibold truncate" style={{ color: BRAND.ink }}>{vendor.name}</div>
        <div className="col-span-3">{renderCertCell("SOC 2")}</div>
        <div className="col-span-3">{renderCertCell("ISO 27001")}</div>
        <div className="col-span-2 flex justify-end items-center gap-2">
          {vendor.status === "done" && (
            <>
              {anyPublic && <div className="flex items-center gap-1 text-xs" style={{ color: BRAND.success }}><Globe size={11} /> Public</div>}
              {anyGated && <div className="flex items-center gap-1 text-xs" style={{ color: BRAND.warn }}><Lock size={11} /> Gated</div>}
            </>
          )}
        </div>
      </div>

      {expanded && vendor.status === "done" && vendor.results && (
        <div className="px-4 pb-5 pt-1 border-t" style={{ borderColor: BRAND.border, background: BRAND.bgPanel }}>
          <div className="flex items-start justify-between gap-4 mt-4 mb-4">
            <div className="text-sm italic flex-1" style={{ color: BRAND.inkSoft }}>"{vendor.results.summary}"</div>
            {onSave && (
              <button onClick={(e) => { e.stopPropagation(); onSave(); }} disabled={isSaved} className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold transition-all shrink-0 disabled:cursor-default"
                style={{ background: isSaved ? BRAND.success : BRAND.bg, color: isSaved ? "#fff" : BRAND.ink, border: `1px solid ${isSaved ? BRAND.success : BRAND.border}` }}>
                {isSaved ? <><Bookmark size={12} fill="#fff" /> Saved</> : <><BookmarkPlus size={12} /> Save to library</>}
              </button>
            )}
          </div>
          {vendor.results.trust_center_url && (
            <a href={vendor.results.trust_center_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-2 text-xs font-semibold mb-4 px-3 py-2 hover:bg-black/5 transition-colors"
              style={{ border: `1px solid ${BRAND.border}`, color: BRAND.ink, background: BRAND.bg }}>
              <Shield size={12} style={{ color: BRAND.red }} /> Visit Trust Center <ExternalLink size={11} style={{ color: BRAND.inkMuted }} />
            </a>
          )}
          <div className="grid md:grid-cols-2 gap-4">
            {vendor.results.certifications?.map((cert) => <CertCard key={cert.name} cert={cert} />)}
          </div>
        </div>
      )}
      {expanded && vendor.status === "error" && (
        <div className="px-4 pb-4 pt-1 border-t" style={{ borderColor: BRAND.border }}>
          <div className="mt-3 p-3 text-xs" style={{ background: BRAND.redSoft, color: BRAND.redDark, border: `1px solid ${BRAND.red}` }}>{vendor.error}</div>
        </div>
      )}
    </div>
  );
}

function CertCard({ cert }) {
  const cmeta = STATUS_META[cert.status] || STATUS_META.not_found;
  const hasSource = !!cert.source_url;
  const ctaLabel = hasSource ? (cert.publicly_accessible ? `Download ${cert.name}` : `Request ${cert.name}`) : null;
  return (
    <div className="p-4 flex flex-col" style={{ background: BRAND.bg, border: `1px solid ${BRAND.border}` }}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-bold" style={{ color: BRAND.ink }}>{cert.name}{cert.type ? ` ${cert.type}` : ""}</div>
        <div className="text-xs font-semibold px-2 py-0.5" style={{ background: cmeta.color, color: "#fff" }}>{cmeta.label}</div>
      </div>
      <p className="text-sm leading-relaxed mb-4 flex-1" style={{ color: BRAND.inkSoft }}>{cert.evidence}</p>
      <div className="flex items-center gap-2 mb-3 text-xs" style={{ color: cert.publicly_accessible ? BRAND.success : BRAND.warn }}>
        {cert.publicly_accessible ? <><Globe size={11} /> Publicly accessible</> : <><Lock size={11} /> NDA / Request required</>}
      </div>
      {cert.name === "ISO 27001" && cert.soa && <SoABlock soa={cert.soa} />}
      {hasSource ? (
        <a href={cert.source_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-semibold transition-all hover:brightness-110" style={{ background: BRAND.red, color: "#fff" }}>
          {ctaLabel} <ArrowRight size={14} />
        </a>
      ) : (
        <div className="px-3 py-2.5 text-xs text-center" style={{ background: BRAND.bgPanel, color: BRAND.inkMuted, border: `1px solid ${BRAND.border}` }}>No direct source available</div>
      )}
    </div>
  );
}

function SoABlock({ soa }) {
  if (!soa) return null;
  const META = {
    bundled:       { label: "BUNDLED WITH CERT",    color: BRAND.success },
    on_request:    { label: "SEPARATE REQUEST",     color: BRAND.warn },
    customer_only: { label: "CUSTOMERS ONLY",       color: BRAND.warn },
    not_found:     { label: "NOT PUBLICLY OFFERED", color: BRAND.red },
  };
  const m = META[soa.availability] || META.not_found;
  return (
    <div className="mb-3 p-3" style={{ background: BRAND.bgPanel, border: `1px solid ${BRAND.border}` }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <FileText size={12} style={{ color: BRAND.red }} />
          <span className="text-xs font-bold" style={{ color: BRAND.ink }}>Statement of Applicability</span>
        </div>
        <span className="text-[10px] font-semibold px-1.5 py-0.5" style={{ background: m.color, color: "#fff" }}>{m.label}</span>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: BRAND.inkSoft }}>{soa.access_notes}</p>
      {soa.soa_url && (
        <a href={soa.soa_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 mt-2 text-[11px] font-semibold hover:underline" style={{ color: BRAND.red }}>
          Access SoA <ExternalLink size={10} />
        </a>
      )}
    </div>
  );
}

// ============================================================
function SavedView({ savedVendors, loading, filter, setFilter, onDelete, onReScan }) {
  const [expandedKey, setExpandedKey] = useState(null);
  const filtered = savedVendors.filter((v) => v.vendor.toLowerCase().includes(filter.toLowerCase()));

  const exportAllCSV = () => {
    const header = ["Vendor", "Saved At", "Trust Center", "SOC 2 Status", "SOC 2 Type", "SOC 2 Public", "SOC 2 Evidence", "SOC 2 Source", "ISO 27001 Status", "ISO 27001 Public", "ISO 27001 Evidence", "ISO 27001 Source", "SoA Availability", "SoA Notes", "SoA URL", "Summary"];
    const rows = savedVendors.map((v) => {
      const soc = v.results.certifications?.find((c) => c.name === "SOC 2");
      const iso = v.results.certifications?.find((c) => c.name === "ISO 27001");
      return [
        v.vendor, new Date(v.savedAt).toLocaleDateString(), v.results.trust_center_url || "",
        soc?.status || "n/a", soc?.type || "", soc?.publicly_accessible ? "Yes" : "No", soc?.evidence || "", soc?.source_url || "",
        iso?.status || "n/a", iso?.publicly_accessible ? "Yes" : "No", iso?.evidence || "", iso?.source_url || "",
        iso?.soa?.availability || "", iso?.soa?.access_notes || "", iso?.soa?.soa_url || "",
        v.results.summary || "",
      ];
    });
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vendor-library-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const stats = savedVendors.reduce((acc, v) => {
    v.results.certifications?.forEach((c) => {
      if (c.status === "verified") acc.verified++;
      else if (c.status === "claimed") acc.claimed++;
      else if (c.status === "not_found") acc.notFound++;
      else if (c.status === "expired") acc.expired++;
    });
    return acc;
  }, { verified: 0, claimed: 0, notFound: 0, expired: 0 });

  return (
    <>
      <div className="mb-10 max-w-3xl">
        <div className="text-xs font-semibold mb-4" style={{ color: BRAND.red, letterSpacing: "0.15em" }}>VENDOR LIBRARY</div>
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight leading-[1.05] mb-5" style={{ color: BRAND.ink }}>
          Your saved <span style={{ color: BRAND.red }}>vendor intelligence</span>.
        </h1>
        <p className="text-lg leading-relaxed" style={{ color: BRAND.inkSoft }}>
          Every vendor you've scanned, archived and searchable. Access trust portals, evidence, and source links anytime.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20" style={{ color: BRAND.inkMuted }}>
          <Loader2 size={20} className="animate-spin mr-2" /> Loading library...
        </div>
      ) : savedVendors.length === 0 ? (
        <div className="text-center py-20" style={{ border: `1px dashed ${BRAND.borderStrong}`, background: BRAND.bgPanel }}>
          <div className="w-14 h-14 mx-auto mb-5 flex items-center justify-center" style={{ background: BRAND.redSoft }}>
            <Database size={24} style={{ color: BRAND.red }} strokeWidth={2} />
          </div>
          <h2 className="text-xl font-bold mb-2" style={{ color: BRAND.ink }}>No saved vendors yet</h2>
          <p className="text-sm" style={{ color: BRAND.inkSoft }}>Run a scan and your results will be saved here automatically.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
            {[
              { label: "Total vendors", val: savedVendors.length, color: BRAND.ink },
              { label: "Verified certs", val: stats.verified, color: BRAND.success },
              { label: "Claimed certs", val: stats.claimed, color: BRAND.warn },
              { label: "Missing certs", val: stats.notFound + stats.expired, color: BRAND.red },
            ].map((s) => (
              <div key={s.label} className="p-4 border" style={{ background: BRAND.bg, borderColor: BRAND.border }}>
                <div className="text-xs font-semibold mb-2" style={{ color: BRAND.inkMuted, letterSpacing: "0.1em", textTransform: "uppercase" }}>{s.label}</div>
                <div className="text-3xl font-bold" style={{ color: s.color }}>{s.val}</div>
              </div>
            ))}
          </div>

          <div className="mb-6 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-[240px] px-3" style={{ background: BRAND.bg, border: `1px solid ${BRAND.border}` }}>
              <Search size={14} style={{ color: BRAND.inkMuted }} />
              <input type="text" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search saved vendors..." className="flex-1 py-2.5 text-sm outline-none bg-transparent" style={{ color: BRAND.ink }} />
              {filter && <button onClick={() => setFilter("")} style={{ color: BRAND.inkMuted }}><X size={14} /></button>}
            </div>
            <button onClick={exportAllCSV} className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold transition-colors hover:brightness-95" style={{ background: BRAND.ink, color: "#fff" }}>
              <Download size={14} /> Export library
            </button>
          </div>

          <div className="grid grid-cols-12 gap-4 px-4 py-2 text-xs font-semibold" style={{ color: BRAND.inkMuted, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            <div className="col-span-3">Vendor</div>
            <div className="col-span-3">SOC 2</div>
            <div className="col-span-3">ISO 27001</div>
            <div className="col-span-2">Saved</div>
            <div className="col-span-1 text-right">Actions</div>
          </div>

          <div className="space-y-2">
            {filtered.length === 0 ? (
              <div className="text-center py-8 text-sm" style={{ color: BRAND.inkMuted }}>No vendors match "{filter}"</div>
            ) : filtered.map((v) => (
              <SavedVendorRow key={v.vendor} record={v} expanded={expandedKey === v.vendor}
                onToggle={() => setExpandedKey(expandedKey === v.vendor ? null : v.vendor)}
                onDelete={() => { if (confirm(`Remove ${v.vendor} from library?`)) onDelete(v.vendor); }}
                onReScan={() => onReScan(v.vendor)} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function SavedVendorRow({ record, expanded, onToggle, onDelete, onReScan }) {
  const renderCertCell = (certName) => {
    const cert = record.results.certifications?.find((c) => c.name === certName);
    if (!cert) return <div className="text-xs" style={{ color: BRAND.inkMuted }}>—</div>;
    const cmeta = STATUS_META[cert.status] || STATUS_META.not_found;
    const CIcon = cmeta.Icon;
    return (
      <div className="flex items-center gap-2">
        <CIcon size={14} style={{ color: cmeta.color }} />
        <span className="text-xs font-semibold" style={{ color: cmeta.color, letterSpacing: "0.05em" }}>{cmeta.label}</span>
        {cert.type && <span className="text-[10px] font-semibold px-1.5 py-0.5" style={{ background: BRAND.bgPanel, color: BRAND.inkSoft, border: `1px solid ${BRAND.border}` }}>{cert.type}</span>}
      </div>
    );
  };

  const savedDate = new Date(record.savedAt);
  const daysAgo = Math.floor((Date.now() - savedDate.getTime()) / (1000 * 60 * 60 * 24));
  const dateLabel = daysAgo === 0 ? "Today" : daysAgo === 1 ? "Yesterday" : `${daysAgo}d ago`;

  return (
    <div onClick={onToggle} className="cursor-pointer transition-all hover:bg-black/[0.02]" style={{ background: BRAND.bg, border: `1px solid ${BRAND.border}` }}>
      <div className="grid grid-cols-12 gap-4 px-4 py-4 items-center">
        <div className="col-span-3 font-semibold truncate" style={{ color: BRAND.ink }}>{record.vendor}</div>
        <div className="col-span-3">{renderCertCell("SOC 2")}</div>
        <div className="col-span-3">{renderCertCell("ISO 27001")}</div>
        <div className="col-span-2 text-xs" style={{ color: BRAND.inkMuted }}>
          {dateLabel} · <span title={savedDate.toLocaleString()}>{savedDate.toLocaleDateString()}</span>
        </div>
        <div className="col-span-1 flex justify-end items-center gap-1">
          <button onClick={(e) => { e.stopPropagation(); onReScan(); }} className="p-1.5 transition-colors hover:bg-black/5" title="Re-scan" style={{ color: BRAND.inkSoft }}>
            <RefreshCw size={13} />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1.5 transition-colors hover:bg-red-50" title="Remove" style={{ color: BRAND.inkSoft }}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-5 pt-1 border-t" style={{ borderColor: BRAND.border, background: BRAND.bgPanel }}>
          <div className="text-sm italic mt-4 mb-4" style={{ color: BRAND.inkSoft }}>"{record.results.summary}"</div>
          {record.results.trust_center_url && (
            <a href={record.results.trust_center_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-2 text-xs font-semibold mb-4 px-3 py-2 hover:bg-black/5 transition-colors" style={{ border: `1px solid ${BRAND.border}`, color: BRAND.ink, background: BRAND.bg }}>
              <Shield size={12} style={{ color: BRAND.red }} /> Visit Trust Center <ExternalLink size={11} style={{ color: BRAND.inkMuted }} />
            </a>
          )}
          <div className="grid md:grid-cols-2 gap-4">
            {record.results.certifications?.map((cert) => <CertCard key={cert.name} cert={cert} />)}
          </div>
        </div>
      )}
    </div>
  );
}
