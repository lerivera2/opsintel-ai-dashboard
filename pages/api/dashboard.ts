/**
 * Dashboard API Endpoint - Data Flow and Module Responsibilities
 * 
 * PURPOSE: Serves aggregated dashboard data with caching and insights for the client application
 * 
 * MODULE RESPONSIBILITIES:
 * - Data Fetch Module: Retrieves raw data from external APIs, databases, or services
 *   • fetchFred.ts: FRED API for Industrial Production Index with MoM trends
 *   • fetchEia.ts: EIA API for Texas electricity pricing with trend analysis
 *   • fetchWeather.ts: OpenWeatherMap API for El Paso weather and alerts
 * - Cache Module: Implements caching strategy to reduce API calls and improve performance
 *   • In-memory cache with configurable TTL (FRED: 1hr, EIA: 10min, Weather: 15min, Insights: 30min)
 *   • SHA-1 hash-based cache invalidation for intelligent updates
 * - Insight Module: Processes raw data to generate analytics, trends, and business insights
 *   • fetchInsight.ts: Claude AI analysis for operational recommendations
 *   • Smart caching prevents redundant AI calls for unchanged data
 * 
 * DATA FLOW:
 * 1. Client Request → API endpoint (/pages/api/dashboard.ts)
 * 2. Check Cache Module → Return cached data if valid and available
 * 3. If cache miss → Data Fetch Module retrieves fresh data from sources
 *    • Concurrent API calls to FRED, EIA, and OpenWeatherMap
 *    • Promise.allSettled() ensures partial failures don't break the system
 * 4. Raw data → Insight Module for processing and analysis
 *    • Generate SHA-1 hash from combined data for change detection
 *    • Call Claude AI only if data hash changed or manual refresh requested
 * 5. Processed data → Cache Module for storage with TTL
 * 6. Final response → Client with structured dashboard data
 * 
 * RESPONSE FORMAT:
 * {
 *   "data": {
 *     "production": { "index": 102.5, "trend": "↑ 2.1% MoM" },
 *     "energy": { "centsPerKwh": 12.8, "trend": "up" },
 *     "weather": { "temp": 95, "alert": "none" },
 *     "insight": {
 *       "summary": "Production strong, energy costs rising",
 *       "recommendation": "Consider energy optimization strategies"
 *     }
 *   },
 *   "lastFetched": "2024-01-15T10:30:00Z",
 *   "lastInsightRun": "2024-01-15T09:45:00Z"
 * }
 * 
 * ERROR HANDLING:
 * - Individual API failures are handled gracefully with fallback data
 * - Claude AI failures fall back to cached insights or contextual defaults
 * - Always returns HTTP 200 with complete response structure
 * - Detailed error logging for monitoring and debugging
 * - Rate limit handling with appropriate retry strategies
 * 
 * PERFORMANCE:
 * - Data caching: Variable TTL (FRED: 1hr, EIA: 10min, Weather: 15min)
 * - Insight caching: 30 minutes TTL for Claude AI responses
 * - Concurrent API calls reduce total response time
 * - SHA-1 hash comparison prevents unnecessary Claude API calls
 * - Manual refresh option via ?refresh=true query parameter
 * - Rate limits: Respects external API limits with caching and fallbacks
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import { getProductionIndex } from '../../src/lib/fetchFred';
import { getEnergyPrice } from '../../src/lib/fetchEia';
import { getLocalWeather } from '../../src/lib/fetchWeather';
import { analyzeInsight } from '../../src/lib/fetchInsight';

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

interface DashboardResponse {
  data: DashboardData;
  lastFetched: string;
  lastInsightRun: string | null;
}

interface DataCacheEntry {
  data: ProductionData | EnergyData | WeatherData;
  lastFetched: string;
  expires: number;
}

interface InsightCacheEntry {
  insight: InsightData;
  dataHash: string;
  lastInsightRun: string;
  expires: number;
}

interface DashboardCacheEntry {
  data: DashboardData;
  dataHash: string;
  lastFetched: string;
  lastInsightRun: string | null;
  expires: number;
}

// Simple in-memory cache for dashboard data
class DashboardCache {
  private dataCache = new Map<string, DataCacheEntry>();
  private insightCache = new Map<string, InsightCacheEntry>();
  private readonly FRED_TTL = 60 * 60 * 1000; // 1 hour
  private readonly EIA_TTL = 10 * 60 * 1000; // 10 minutes
  private readonly WEATHER_TTL = 15 * 60 * 1000; // 15 minutes
  private readonly INSIGHT_TTL = 30 * 60 * 1000; // 30 minutes

  setData(key: string, data: ProductionData | EnergyData | WeatherData, ttl: number) {
    const now = new Date().toISOString();
    this.dataCache.set(key, {
      data,
      lastFetched: now,
      expires: Date.now() + ttl
    });
  }

  getData(key: string): DataCacheEntry | null {
    const item = this.dataCache.get(key);
    if (!item || Date.now() > item.expires) {
      this.dataCache.delete(key);
      return null;
    }
    return item;
  }

  setInsight(dataHash: string, insight: InsightData) {
    const now = new Date().toISOString();
    this.insightCache.set(dataHash, {
      insight,
      dataHash,
      lastInsightRun: now,
      expires: Date.now() + this.INSIGHT_TTL
    });
  }

  getInsight(dataHash: string): InsightCacheEntry | null {
    const item = this.insightCache.get(dataHash);
    if (!item || Date.now() > item.expires) {
      this.insightCache.delete(dataHash);
      return null;
    }
    return item;
  }

  getLatestInsight(): InsightCacheEntry | null {
    let latest: InsightCacheEntry | null = null;
    let latestTime = 0;
    
    for (const entry of this.insightCache.values()) {
      const entryTime = new Date(entry.lastInsightRun).getTime();
      if (entryTime > latestTime) {
        latest = entry;
        latestTime = entryTime;
      }
    }
    
    return latest;
  }

  getTTL(source: string): number {
    switch (source) {
      case 'fred': return this.FRED_TTL;
      case 'eia': return this.EIA_TTL;
      case 'weather': return this.WEATHER_TTL;
      default: return this.EIA_TTL;
    }
  }
}

const cache = new DashboardCache();

/**
 * Generates SHA-1 hash from combined data for cache invalidation
 */
function generateDataHash(production: ProductionData, energy: EnergyData, weather: WeatherData): string {
  const combinedData = {
    production: {
      index: Math.round(production.index * 10) / 10,
      trend: production.trend
    },
    energy: {
      centsPerKwh: Math.round(energy.centsPerKwh * 100) / 100,
      trend: energy.trend
    },
    weather: {
      temp: Math.round(weather.temp / 5) * 5, // Round to nearest 5°
      alert: weather.alert
    }
  };

  const dataString = JSON.stringify(combinedData, Object.keys(combinedData).sort());
  return crypto.createHash('sha1').update(dataString).digest('hex');
}

/**
 * Fetches data from a specific source with caching and error handling
 */
async function fetchWithCache<T>(
  source: string,
  fetchFn: () => Promise<T>,
  fallback: T
): Promise<{ data: T; lastFetched: string }> {
  // Check cache first
  const cached = cache.getData(source);
  if (cached) {
    return {
      data: cached.data as T,
      lastFetched: cached.lastFetched
    };
  }

  // Fetch fresh data
  try {
    const data = await fetchFn();
    const ttl = cache.getTTL(source);
    cache.setData(source, data, ttl);
    
    const cachedEntry = cache.getData(source);
    return {
      data,
      lastFetched: cachedEntry?.lastFetched || new Date().toISOString()
    };
  } catch (error) {
    console.error(`Error fetching ${source} data:`, error);
    
    // Return fallback data
    return {
      data: fallback,
      lastFetched: new Date().toISOString()
    };
  }
}

/**
 * Fetches data from all sources with individual caching and error handling
 */
async function fetchAllData(): Promise<{
  production: ProductionData;
  energy: EnergyData;
  weather: WeatherData;
  lastFetched: string;
}> {
  // Fetch all data sources concurrently with individual caching
  const [productionResult, energyResult, weatherResult] = await Promise.allSettled([
    fetchWithCache('fred', getProductionIndex, { index: 102.4, trend: '→ Data unavailable' }),
    fetchWithCache('eia', getEnergyPrice, { centsPerKwh: 12.5, trend: 'stable' as const }),
    fetchWithCache('weather', getLocalWeather, { temp: 75, alert: 'Weather data unavailable' })
  ]);

  // Extract data with fallbacks
  const production = productionResult.status === 'fulfilled' 
    ? productionResult.value.data 
    : { index: 102.4, trend: '→ Data unavailable' };

  const energy = energyResult.status === 'fulfilled' 
    ? energyResult.value.data 
    : { centsPerKwh: 12.5, trend: 'stable' as const };

  const weather = weatherResult.status === 'fulfilled' 
    ? weatherResult.value.data 
    : { temp: 75, alert: 'Weather data unavailable' };

  // Get the most recent lastFetched timestamp
  const timestamps = [
    productionResult.status === 'fulfilled' ? productionResult.value.lastFetched : null,
    energyResult.status === 'fulfilled' ? energyResult.value.lastFetched : null,
    weatherResult.status === 'fulfilled' ? weatherResult.value.lastFetched : null
  ].filter(Boolean) as string[];

  const lastFetched = timestamps.length > 0 
    ? new Date(Math.max(...timestamps.map(t => new Date(t).getTime()))).toISOString()
    : new Date().toISOString();

  // Log any failures for debugging
  if (productionResult.status === 'rejected') {
    console.error('Production data fetch failed:', productionResult.reason);
  }
  if (energyResult.status === 'rejected') {
    console.error('Energy data fetch failed:', energyResult.reason);
  }
  if (weatherResult.status === 'rejected') {
    console.error('Weather data fetch failed:', weatherResult.reason);
  }

  return { production, energy, weather, lastFetched };
}

/**
 * Main dashboard API handler
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<DashboardResponse>
) {
  try {
    const isManualRefresh = req.query.refresh === 'true';

    // Fetch all data sources
    const { production, energy, weather, lastFetched } = await fetchAllData();

    // Generate hash for change detection
    const currentDataHash = generateDataHash(production, energy, weather);

    // Check if we need new insights (data changed or manual refresh)
    const cachedInsight = cache.getInsight(currentDataHash);
    const needsInsightUpdate = isManualRefresh || !cachedInsight;

    let insight: InsightData;
    let lastInsightRun: string | null = null;

    if (needsInsightUpdate) {
      console.log('Generating new insights with Claude AI...');
      try {
        insight = await analyzeInsight({ production, energy, weather });
        cache.setInsight(currentDataHash, insight);
        const newCachedInsight = cache.getInsight(currentDataHash);
        lastInsightRun = newCachedInsight?.lastInsightRun || new Date().toISOString();
      } catch (error) {
        console.error('Claude insight generation failed:', error);
        
        // Try to use any available cached insight
        const latestInsight = cache.getLatestInsight();
        if (latestInsight) {
          insight = latestInsight.insight;
          lastInsightRun = latestInsight.lastInsightRun;
        } else {
          // Generate contextual fallback based on data patterns
          insight = generateFallbackInsight(production, energy, weather);
          lastInsightRun = null;
        }
      }
    } else {
      // Use cached insight
      insight = cachedInsight.insight;
      lastInsightRun = cachedInsight.lastInsightRun;
    }

    // Construct response data
    const dashboardData: DashboardData = {
      production,
      energy,
      weather,
      insight
    };

    const response: DashboardResponse = {
      data: dashboardData,
      lastFetched,
      lastInsightRun
    };

    res.status(200).json(response);

  } catch (error) {
    console.error('Dashboard API error:', error);

    // Return fallback response with proper metadata
    const fallbackResponse: DashboardResponse = {
      data: {
        production: { index: 102.4, trend: '→ Data unavailable' },
        energy: { centsPerKwh: 12.5, trend: 'stable' },
        weather: { temp: 75, alert: 'Data unavailable' },
        insight: {
          summary: 'System temporarily unavailable',
          recommendation: 'Please try refreshing in a few minutes'
        }
      },
      lastFetched: new Date().toISOString(),
      lastInsightRun: null
    };

    res.status(200).json(fallbackResponse);
  }
}

/**
 * Generates contextual fallback insights based on data patterns
 */
function generateFallbackInsight(
  production: ProductionData, 
  energy: EnergyData, 
  weather: WeatherData
): InsightData {
  let summary = "Data analysis temporarily unavailable";
  let recommendation = "Monitor key metrics and adjust operations as needed";

  // Provide basic insights based on data patterns
  if (weather.temp >= 100) {
    summary = "Extreme heat conditions detected";
    recommendation = "Consider shifting operations to cooler hours to reduce energy costs";
  } else if (energy.trend === 'up') {
    summary = "Energy costs trending upward";
    recommendation = "Optimize energy usage and consider off-peak scheduling";
  } else if (weather.alert !== 'none' && weather.alert !== 'Weather data unavailable') {
    summary = "Weather alert active";
    recommendation = "Monitor weather conditions and prepare contingency plans";
  } else if (production.trend.includes('↓')) {
    summary = "Production index declining";
    recommendation = "Review production processes and identify improvement opportunities";
  } else if (production.trend.includes('↑')) {
    summary = "Production performing well";
    recommendation = "Maintain current efficiency while monitoring energy costs";
  }

  return {
    summary,
    recommendation
  };
}