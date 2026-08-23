import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

function formatShortDate(value, index) {
  const raw = String(value || "").trim();
  if (!raw) {
    return `#${index + 1}`;
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return `#${index + 1}`;
  }

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function HistoryTrendChart({ title, data, lines = [], emptyText = "No trend data yet." }) {
  const rows = Array.isArray(data) ? data : [];

  return (
    <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
      <h4 className="text-md font-medium text-[#1f2937] mb-4">{title}</h4>
      {rows.length === 0 ? (
        <div className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg px-4 py-8 text-center">
          {emptyText}
        </div>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
              <XAxis
                dataKey="xLabel"
                tick={{ fill: "#64748b", fontSize: 12 }}
                tickLine={false}
                axisLine={{ stroke: "#cbd5e1" }}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fill: "#64748b", fontSize: 12 }}
                tickLine={false}
                axisLine={{ stroke: "#cbd5e1" }}
              />
              <Tooltip
                labelFormatter={(_label, payload) => {
                  const row = payload?.[0]?.payload || {};
                  return row?.analyzedAt || row?.xLabel || "";
                }}
              />
              {lines.map((line) => (
                <Line
                  key={line.key}
                  type="monotone"
                  dataKey={line.key}
                  name={line.label || line.key}
                  stroke={line.color || "#0f172a"}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export function mapHistoryRowsForChart(rows = []) {
  return rows.map((row, index) => ({
    ...row,
    xLabel: formatShortDate(row?.analyzedAt, index),
  }));
}
