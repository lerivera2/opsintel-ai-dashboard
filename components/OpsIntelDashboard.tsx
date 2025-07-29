import { useEffect, useState } from "react";

export default function OpsIntelDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = async () => {
    try {
      const res = await fetch("/api/dashboard");
      const json = await res.json();
      setData(json);
      setLoading(false);
    } catch (err) {
      setError("Error fetching data");
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 300000); // every 5 mins
    return () => clearInterval(interval);
  }, []);

  if (loading) return <div className="p-4">Loading...</div>;
  if (error) return <div className="p-4 text-red-500">{error}</div>;

  return (
    <div className="p-4 space-y-6">
      <header className="text-white text-2xl font-bold">
        OpsIntel AI Dashboard
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <MetricCard title="Production Index" value={data.production.index} unit="pts" trend={data.production.trend} />
        <MetricCard title="Energy Cost" value={data.energy.centsPerKwh} unit="¢/kWh" trend={data.energy.trend} />
        <MetricCard title="Temperature Forecast" value={data.weather.temp} unit="°F" trend={data.weather.alert} />
      </div>

      <div className="bg-gray-800 p-4 rounded-xl text-white">
        <h2 className="text-lg font-semibold mb-2">Claude AI Insight</h2>
        <p className="mb-1">{data.insight.summary}</p>
        <p className="font-medium">💡 {data.insight.recommendation}</p>
        <button
          className="mt-4 px-4 py-2 bg-blue-500 hover:bg-blue-600 rounded text-white"
          onClick={fetchData}
        >
          🔁 Refresh Insight
        </button>
      </div>

      <footer className="text-sm text-gray-400 pt-4">
        Last updated: {new Date().toLocaleTimeString()} | Powered by FRED, EIA, OpenWeather, Claude
      </footer>
    </div>
  );
}

function MetricCard({ title, value, unit, trend }) {
  return (
    <div className="bg-gray-900 p-4 rounded-xl text-white shadow">
      <h3 className="text-md font-medium mb-1">{title}</h3>
      <p className="text-2xl font-bold">
        {value} <span className="text-sm">{unit}</span>
      </p>
      <p className="text-sm text-gray-400 mt-1">{trend}</p>
    </div>
  );
}