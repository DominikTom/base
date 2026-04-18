'use client';

import { useEffect, useState } from 'react';
import { Database, Table, ChevronDown, ChevronRight, Search, Rows3, Columns3 } from 'lucide-react';

interface ColumnInfo {
  name: string;
  type: string;
  nullable?: boolean;
  sample?: unknown;
}

interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  rowCount: number;
}

interface PreviewData {
  table: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>[];
  columns: ColumnInfo[];
  totalCount: number;
  offset: number;
  limit: number;
}

export default function DatabasePage() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTable, setExpandedTable] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  useEffect(() => {
    async function loadTables() {
      try {
        const res = await fetch('/api/dashboard/database?action=tables');
        const json = await res.json();
        setTables(json.tables || []);
      } catch { /* ignore */ }
      setLoading(false);
    }
    loadTables();
  }, []);

  async function loadPreview(tableName: string, offset = 0) {
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/dashboard/database?action=preview&table=${tableName}&limit=${PAGE_SIZE}&offset=${offset}`);
      const json = await res.json();
      setPreview(json);
      setPage(Math.floor(offset / PAGE_SIZE));
    } catch { /* ignore */ }
    setPreviewLoading(false);
  }

  function handleTableClick(tableName: string) {
    if (expandedTable === tableName) {
      setExpandedTable(null);
      setPreview(null);
    } else {
      setExpandedTable(tableName);
      loadPreview(tableName, 0);
    }
  }

  const filteredTables = tables.filter(t => t.name.toLowerCase().includes(search.toLowerCase()));
  const totalRows = tables.reduce((s, t) => s + (t.rowCount || 0), 0);

  const typeColor = (type: string) => {
    if (type.includes('int') || type.includes('numeric') || type.includes('float') || type.includes('double')) return 'text-blue-400';
    if (type.includes('text') || type.includes('char') || type.includes('string')) return 'text-emerald-400';
    if (type.includes('bool')) return 'text-amber-400';
    if (type.includes('timestamp') || type.includes('date')) return 'text-purple-400';
    if (type.includes('json')) return 'text-orange-400';
    if (type.includes('uuid')) return 'text-cyan-400';
    return 'text-zinc-400';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-pulse text-zinc-500">Ładowanie schema...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100 flex items-center gap-2">
            <Database size={22} />
            Baza danych
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            {tables.length} tabel &middot; {totalRows.toLocaleString('pl-PL')} wierszy łącznie
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Szukaj tabeli..."
          className="w-full pl-9 pr-4 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Table list */}
      <div className="space-y-1">
        {filteredTables.map(table => (
          <div key={table.name}>
            {/* Table row */}
            <button
              onClick={() => handleTableClick(table.name)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
                expandedTable === table.name ? 'bg-zinc-800 border border-zinc-700' : 'hover:bg-zinc-800/50'
              }`}
            >
              {expandedTable === table.name ? <ChevronDown size={16} className="text-zinc-400" /> : <ChevronRight size={16} className="text-zinc-600" />}
              <Table size={16} className="text-blue-400 shrink-0" />
              <span className="text-sm font-medium text-zinc-200 font-mono">{table.name}</span>
              <span className="ml-auto flex items-center gap-4 text-xs text-zinc-500">
                <span className="flex items-center gap-1"><Columns3 size={12} /> {table.columns?.length || '?'} kolumn</span>
                <span className="flex items-center gap-1"><Rows3 size={12} /> {(table.rowCount || 0).toLocaleString('pl-PL')} wierszy</span>
              </span>
            </button>

            {/* Expanded: columns + preview */}
            {expandedTable === table.name && (
              <div className="ml-6 mr-2 mt-1 mb-3 space-y-3">
                {/* Column schema */}
                <div className="rounded-lg border border-zinc-800 overflow-hidden">
                  <div className="px-3 py-2 bg-zinc-900 border-b border-zinc-800 text-xs font-medium text-zinc-400">
                    Schema
                  </div>
                  <div className="divide-y divide-zinc-800/50">
                    {table.columns?.map(col => (
                      <div key={col.name} className="flex items-center gap-3 px-3 py-1.5 text-xs">
                        <span className="font-mono text-zinc-300 w-48 truncate" title={col.name}>{col.name}</span>
                        <span className={`font-mono ${typeColor(col.type)} w-32`}>{col.type}</span>
                        {col.nullable && <span className="text-zinc-600 text-[10px]">nullable</span>}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Data preview */}
                <div className="rounded-lg border border-zinc-800 overflow-hidden">
                  <div className="px-3 py-2 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-400">
                      Podgląd danych {preview ? `(${preview.offset + 1}–${Math.min(preview.offset + preview.limit, preview.totalCount)} z ${preview.totalCount.toLocaleString('pl-PL')})` : ''}
                    </span>
                    {preview && preview.totalCount > PAGE_SIZE && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => loadPreview(table.name, Math.max(0, (page - 1) * PAGE_SIZE))}
                          disabled={page === 0}
                          className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-30"
                        >
                          ← Poprzednia
                        </button>
                        <span className="text-xs text-zinc-500">
                          {page + 1} / {Math.ceil(preview.totalCount / PAGE_SIZE)}
                        </span>
                        <button
                          onClick={() => loadPreview(table.name, (page + 1) * PAGE_SIZE)}
                          disabled={(page + 1) * PAGE_SIZE >= preview.totalCount}
                          className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-30"
                        >
                          Następna →
                        </button>
                      </div>
                    )}
                  </div>
                  {previewLoading ? (
                    <div className="p-8 text-center text-zinc-500 text-sm animate-pulse">Ładowanie...</div>
                  ) : preview?.data && preview.data.length > 0 ? (
                    <div className="overflow-auto max-h-[500px]">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-zinc-900">
                          <tr>
                            {Object.keys(preview.data[0]).map(key => (
                              <th key={key} className="px-3 py-2 text-left font-medium text-zinc-400 border-b border-zinc-800 whitespace-nowrap font-mono">
                                {key}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {preview.data.map((row, i) => (
                            <tr key={i} className="border-b border-zinc-800/30 hover:bg-zinc-800/30">
                              {Object.values(row).map((val, j) => (
                                <td key={j} className="px-3 py-1.5 text-zinc-300 whitespace-nowrap max-w-[300px] truncate" title={String(val ?? '')}>
                                  {val === null ? <span className="text-zinc-600 italic">null</span>
                                    : typeof val === 'boolean' ? <span className={val ? 'text-emerald-400' : 'text-red-400'}>{String(val)}</span>
                                    : typeof val === 'object' ? <span className="text-orange-400">{JSON.stringify(val).substring(0, 80)}</span>
                                    : String(val)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="p-8 text-center text-zinc-500 text-sm">Brak danych</div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
