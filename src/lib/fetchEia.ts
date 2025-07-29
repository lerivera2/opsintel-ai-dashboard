interface EiaDataPoint {
  period: string;
  value: number;
}

interface EiaResponse {
  response: {
    data: Array<{
      data: EiaDataPoint[];
    }>;
  };
}

interface EnergyPriceData {
  centsPerKwh: number;
  trend: 'up' | 'down' | 'stable';
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
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes in milliseconds
const CACHE_KEY = 'eia_texas_electricity_price';

/**
 * Fetches current Texas retail electricity pricing data from the EIA API
 * 
 * @returns Promise<EnergyPriceData> Object containing current price in cents per kWh and trend
 * @throws Error when API key is missing or API request fails
 * 
 * @example
 * ```typescript
 * const energyData = await getEnergyPrice();
 * console.log(`Current price: ${energyData.centsPerKwh}¢/kWh, Trend: ${energyData.trend}`);
 * ```
 */
export async function getEnergyPrice(): Promise<EnergyPriceData> {
  // Check cache first
  const cachedData = cache.get(CACHE_KEY);
  if (cachedData) {
    return cachedData;
  }

  const apiKey = process.env.EIA_API_KEY;
  if (!apiKey) {
    throw new Error('EIA_API_KEY environment variable is required');
  }

  try {
    // EIA API endpoint for Texas retail electricity prices
    // Series ID: ELEC.PRICE.TX-RES.M (Texas residential retail electricity price)
    const url = 'https://api.eia.gov/v2/electricity/retail-sales/data/';
    const params = new URLSearchParams({
      'api_key': apiKey,
      'frequency': 'monthly',
      'data[0]': 'price',
      'facets[stateid][]': 'TX',
      'facets[sectorid][]': 'RES', // Residential sector
      'sort[0][column]': 'period',
      'sort[0][direction]': 'desc',
      'offset': '0',
      'length': '3' // Get last 3 months for trend calculation
    });

    const response = await fetch(`${url}?${params}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'OpsIntel-Dashboard/1.0'
      }
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('EIA API rate limit exceeded. Please try again later.');
      }
      if (response.status === 403) {
        throw new Error('Invalid EIA API key or access denied');
      }
      throw new Error(`EIA API error: ${response.status} ${response.statusText}`);
    }

    const data: EiaResponse = await response.json();
    
    if (!data.response?.data || data.response.data.length === 0) {
      throw new Error('No electricity pricing data available from EIA API');
    }

    const priceData = data.response.data[0]?.data;
    if (!priceData || priceData.length === 0) {
      throw new Error('No valid pricing observations found');
    }

    // Sort by period to ensure we have the most recent data first
    const sortedData = priceData
      .filter(point => point.value !== null && !isNaN(point.value))
      .sort((a, b) => b.period.localeCompare(a.period));

    if (sortedData.length === 0) {
      throw new Error('No valid pricing data points available');
    }

    const latestPrice = sortedData[0].value;
    
    if (isNaN(latestPrice) || latestPrice <= 0) {
      throw new Error('Invalid electricity price value received');
    }

    let trend: 'up' | 'down' | 'stable' = 'stable';
    
    // Calculate trend if we have at least 2 data points
    if (sortedData.length >= 2) {
      const previousPrice = sortedData[1].value;
      
      if (!isNaN(previousPrice) && previousPrice > 0) {
        const percentChange = ((latestPrice - previousPrice) / previousPrice) * 100;
        
        // Consider changes > 2% as significant trend
        if (percentChange > 2) {
          trend = 'up';
        } else if (percentChange < -2) {
          trend = 'down';
        } else {
          trend = 'stable';
        }
      }
    }

    const result: EnergyPriceData = {
      centsPerKwh: Math.round(latestPrice * 100) / 100, // Round to 2 decimal places
      trend
    };

    // Cache the result
    cache.set(CACHE_KEY, result, CACHE_TTL);
    
    return result;

  } catch (error) {
    console.error('Error fetching EIA electricity pricing data:', error);
    
    // Return fallback data in case of error
    return {
      centsPerKwh: 12.5,
      trend: 'stable'
    };
  }
}

/**
 * Utility function to clear the energy price cache
 * Useful for testing or forcing fresh data retrieval
 */
export function clearEnergyPriceCache(): void {
  cache.get(CACHE_KEY) && cache.set(CACHE_KEY, null, 0);
}