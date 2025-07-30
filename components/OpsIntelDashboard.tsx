import { useEffect, useState } from "react";

interface ProductionData {
  index: number;
  trend: string;
}

interface EnergyData {
  centsPerKwh: number;
  trend: 'up' | 'down' | 'stable';
}

interface WeatherData {
  temp: number;
  alert: string;
}

interface InsightData {
  summary: string;
  recommendation: string;
}

interface DashboardData {
  production: ProductionData;
  energy: EnergyData;
  weather: WeatherData;
  insight: InsightData;
}

const defaultDashboardData: DashboardData = {
  production: { index: 0, trend: 'Loading...' },
  energy: { centsPerKwh: 0, trend: 'stable' },
  weather: { temp: 0, alert: 'Loading...' },
  insight: { summary: 'Fetching insights...', recommendation: 'Please wait...' }
};

export default function OpsIntelDashboard() {
  const [data, setData] = useState<DashboardData>(defaultDashboardData);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [lastInsightRun, setLastInsightRun] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard");
      const json = await res.json();
      if (json && json.data) {
        setData(json.data);
        setLastFetched(json.lastFetched);
        setLastInsightRun(json.lastInsightRun);
      } else {
        setError("Received invalid data structure from API.");
      }
    } catch (err) {
      console.error("Error in fetchData:", err);
      setError("Error fetching data from dashboard API.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 300000); // every 5 mins
    return () => clearInterval(interval);
  }, []);

  if (loading && data === defaultDashboardData) return <div className="p-4">Loading...</div>;
  if (error) return <div className="p-4 text-red-500">{error}</div>;
  if (!data) return <div className="p-4 text-red-500">Dashboard data not available.</div>;

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
          onClick={() => {
            setLoading(true);
            const refreshUrl = "/api/dashboard?refresh=true";
            fetch(refreshUrl)
              .then(res => res.json())
              .then(json => {
                if (json && json.data) {
                  setData(json.data);
                  setLastFetched(json.lastFetched);
                  setLastInsightRun(json.lastInsightRun);
                } else {
                  setError("Received invalid data structure on refresh.");
                }
              })
              .catch(err => {
                console.error('Refresh failed:', err);
                setError("Refresh failed: Could not fetch new data.");
              })
              .finally(() => {
                setLoading(false);
              });
          }}
        >
          🔁 Refresh Insight
        </button>
      </div>

      <footer className="text-sm text-gray-400 pt-4 space-y-1">
        <div>Data updated: {lastFetched ? new Date(lastFetched).toLocaleTimeString() : 'Loading...'}</div>
        <div>Insights updated: {lastInsightRun ? new Date(lastInsightRun).toLocaleTimeString() : 'Loading...'}</div>
        <div>Powered by FRED, EIA, OpenWeather, Claude</div>
      </footer>
    </div>
  );
}
 
interface MetricCardProps {
  title: string;
  value: number;
  unit: string;
  trend: string;
}

function MetricCard({ title, value, unit, trend }: MetricCardProps) {
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