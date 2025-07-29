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
  lastInsightRun: string;
}

interface CacheEntry {
  data: DashboardData;
  dataHash: string;
  lastFetched: string;
  lastInsightRun: string;
  expires: number;
}

// Simple in-memory cache for dashboard data
class DashboardCache {
  private cache = new Map<string, CacheEntry>();
  private readonly DATA_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly INSIGHT_TTL = 30 * 60 * 1000; // 30 minutes

  set(key: string, data: DashboardData, dataHash: string, insightUpdated: boolean = false) {
    const now = new Date().toISOString();
    const existing = this.cache.get(key);
    
    this.cache.set(key, {
      data,
      dataHash,
      lastFetched: now,
      lastInsightRun: insightUpdated ? now : (existing?.lastInsightRun || now),
      expires: Date.now() + this.DATA_TTL
    });
  }

  get(key: string): CacheEntry | null {
    const item = this.cache.get(key);
    if (!item || Date.now() > item.expires) {
      this.cache.delete(key);
      return null;
    }
    return item;
  }

  needsInsightUpdate(dataHash: string): boolean {
    const cached = this.get('dashboard');
    if (!cached) return true;
    
    // Check if data hash changed or insight is too old
    const insightAge = Date.now() - new Date(cached.lastInsightRun).getTime();
    return cached.dataHash !== dataHash || insightAge > this.INSIGHT_TTL;
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
 * Fetches data from all sources with error handling
 */
async function fetchAllData(): Promise<{
  production: ProductionData;
  energy: EnergyData;
  weather: WeatherData;
}> {
  const [productionResult, energyResult, weatherResult] = await Promise.allSettled([
    getProductionIndex(),
    getEnergyPrice(),
    getLocalWeather()
  ]);

  // Extract data with fallbacks
  const production: ProductionData = productionResult.status === 'fulfilled'
    ? productionResult.value
    : { index: 102.4, trend: '→ Data unavailable' };

  const energy: EnergyData = energyResult.status === 'fulfilled'
    ? energyResult.value
    : { centsPerKwh: 12.5, trend: 'stable' };

  const weather: WeatherData = weatherResult.status === 'fulfilled'
    ? weatherResult.value
    : { temp: 75, alert: 'Weather data unavailable' };

  // Log any failures
  if (productionResult.status === 'rejected') {
    console.error('Production data fetch failed:', productionResult.reason);
  }
  if (energyResult.status === 'rejected') {
    console.error('Energy data fetch failed:', energyResult.reason);
  }
  if (weatherResult.status === 'rejected') {
    console.error('Weather data fetch failed:', weatherResult.reason);
  }

  return { production, energy, weather };
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
    const { production, energy, weather } = await fetchAllData();

    // Generate hash for change detection
    const currentDataHash = generateDataHash(production, energy, weather);

    // Check if we need new insights
    const needsInsightUpdate = isManualRefresh || cache.needsInsightUpdate(currentDataHash);

    let insight: InsightData;
    let insightUpdated = false;

    if (needsInsightUpdate) {
      console.log('Generating new insights with Claude AI...');
      try {
        insight = await analyzeInsight({ production, energy, weather });
        insightUpdated = true;
      } catch (error) {
        console.error('Claude insight generation failed:', error);
        // Use cached insight if available
        const cached = cache.get('dashboard');
        insight = cached?.data.insight || {
          summary: 'Analysis temporarily unavailable',
          recommendation: 'Monitor conditions and try refreshing later'
        };
      }
    } else {
      // Use cached insight
      const cached = cache.get('dashboard');
      insight = cached?.data.insight || {
        summary: 'Using cached analysis',
        recommendation: 'Data unchanged since last analysis'
      };
    }

    // Construct response data
    const dashboardData: DashboardData = {
      production,
      energy,
      weather,
      insight
    };

    // Update cache
    cache.set('dashboard', dashboardData, currentDataHash, insightUpdated);

    // Get timestamps from cache
    const cacheEntry = cache.get('dashboard');
    const response: DashboardResponse = {
      data: dashboardData,
      lastFetched: cacheEntry?.lastFetched || new Date().toISOString(),
      lastInsightRun: cacheEntry?.lastInsightRun || new Date().toISOString()
    };

    res.status(200).json(response);

  } catch (error) {
    console.error('Dashboard API error:', error);

    // Return fallback response
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
      lastInsightRun: new Date().toISOString()
    };

    res.status(200).json(fallbackResponse);
  }
}