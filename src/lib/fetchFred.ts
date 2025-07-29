interface FredObservation {
  date: string;
  value: string;
}

interface FredResponse {
  observations: FredObservation[];
}

interface ProductionData {
  index: number;
  trend: string;
}

// Simple in-memory cache with TTL
class SimpleCache {
  private cache = new Map<string, { data: any; expires: number }>();

  set(key: string, data: any, ttlMs: number) {
    this.cache.set(key, {
      data,
      expires: Date.now() + ttlMs
    });
  }

  get(key: string) {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expires) {
      this.cache.delete(key);
      return null;
    }
    
    return item.data;
  }
}

const cache = new SimpleCache();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour in milliseconds
const CACHE_KEY = 'fred_production_index';

export async function getProductionIndex(): Promise<ProductionData> {
  // Check cache first
  const cachedData = cache.get(CACHE_KEY);
  if (cachedData) {
    return cachedData;
  }

  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    throw new Error('FRED_API_KEY environment variable is required');
  }

  try {
    // Fetch last 3 months of data to calculate MoM trend
    const url = `https://api.stlouisfed.org/fred/series/observations`;
    const params = new URLSearchParams({
      series_id: 'INDPRO',
      api_key: apiKey,
      file_type: 'json',
      limit: '3',
      sort_order: 'desc',
      observation_start: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    });

    const response = await fetch(`${url}?${params}`);
    
    if (!response.ok) {
      throw new Error(`FRED API error: ${response.status} ${response.statusText}`);
    }

    const data: FredResponse = await response.json();
    
    if (!data.observations || data.observations.length === 0) {
      throw new Error('No production data available from FRED API');
    }

    // Filter out any observations with "." (missing data)
    const validObservations = data.observations
      .filter(obs => obs.value !== '.')
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    if (validObservations.length < 1) {
      throw new Error('No valid production data available');
    }

    const latestValue = parseFloat(validObservations[0].value);
    
    if (isNaN(latestValue)) {
      throw new Error('Invalid production index value received');
    }

    let trend = '→ No data';
    
    // Calculate MoM trend if we have at least 2 data points
    if (validObservations.length >= 2) {
      const previousValue = parseFloat(validObservations[1].value);
      
      if (!isNaN(previousValue) && previousValue !== 0) {
        const percentChange = ((latestValue - previousValue) / previousValue) * 100;
        const sign = percentChange > 0 ? '↑' : percentChange < 0 ? '↓' : '→';
        trend = `${sign} ${Math.abs(percentChange).toFixed(1)}% MoM`;
      }
    }

    const result: ProductionData = {
      index: Math.round(latestValue * 10) / 10, // Round to 1 decimal place
      trend
    };

    // Cache the result
    cache.set(CACHE_KEY, result, CACHE_TTL);
    
    return result;

  } catch (error) {
    console.error('Error fetching FRED production data:', error);
    
    // Return fallback data in case of error
    return {
      index: 102.4,
      trend: '→ Data unavailable'
    };
  }
}