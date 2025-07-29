import type { NextApiRequest, NextApiResponse } from 'next';
import { getProductionIndex } from '../../src/lib/fetchFred';
import { getEnergyPrice } from '../../src/lib/fetchEia';
import { getLocalWeather } from '../../src/lib/fetchWeather';

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

interface DashboardResponse {
  production: ProductionData;
  energy: EnergyData;
  weather: WeatherData;
  insight: InsightData;
}

interface CachedData {
  data: DashboardResponse;
  timestamp: number;
  dataHash: string;
}

// Simple in-memory cache for dashboard data and insights
class DashboardCache {
  private cache = new Map<string, CachedData>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes for dashboard data
  private readonly INSIGHT_TTL = 30 * 60 * 1000; // 30 minutes for Claude insights

  set(key: string, data: DashboardResponse, dataHash: string) {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      dataHash
    });
  }

  get(key: string): CachedData | null {
    const item = this.cache.get(key);
    if (!item) return null;

    const ttl = key.includes('insight') ? this.INSIGHT_TTL : this.CACHE_TTL;
    if (Date.now() - item.timestamp > ttl) {
      this.cache.delete(key);
      return null;
    }

    return item;
  }

  hasSignificantChange(newDataHash: string): boolean {
    const cached = this.get('dashboard');
    return !cached || cached.dataHash !== newDataHash;
  }
}

const cache = new DashboardCache();

/**
 * Generates a hash of the data to detect significant changes
 */
function generateDataHash(production: ProductionData, energy: EnergyData, weather: WeatherData): string {
  // Create a hash based on key values that would trigger new insights
  const significantData = {
    productionIndex: Math.round(production.index * 10), // Round to 1 decimal
    energyPrice: Math.round(energy.centsPerKwh * 100), // Round to 2 decimals
    weatherTemp: Math.round(weather.temp / 5) * 5, // Round to nearest 5 degrees
    weatherAlert: weather.alert !== 'none' ? 'alert' : 'none',
    energyTrend: energy.trend,
    productionTrend: production.trend.includes('↑') ? 'up' : production.trend.includes('↓') ? 'down' : 'stable'
  };

  return JSON.stringify(significantData);
}

/**
 * Analyzes operational data using Claude AI to generate insights and recommendations
 */
async function analyzeInsight(data: { production: ProductionData; energy: EnergyData; weather: WeatherData }): Promise<InsightData> {
  try {
    const claudeApiKey = process.env.CLAUDE_API_KEY;
    if (!claudeApiKey) {
      throw new Error('CLAUDE_API_KEY environment variable is required');
    }

    const prompt = `Analyze this manufacturing operations data for El Paso, TX and provide a brief insight:

Production Index: ${data.production.index} (${data.production.trend})
Energy Cost: ${data.energy.centsPerKwh}¢/kWh (trend: ${data.energy.trend})
Weather: ${data.weather.temp}°F (alert: ${data.weather.alert})

Provide a concise analysis in this format:
1. A brief summary of the current operational conditions (max 15 words)
2. One actionable recommendation for manufacturing operations (max 20 words)

Focus on cost optimization, production efficiency, and weather-related operational adjustments.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: prompt
        }]
      }),
      signal: AbortSignal.timeout(15000) // 15 second timeout
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    const content = result.content?.[0]?.text || '';

    // Parse the response to extract summary and recommendation
    const lines = content.split('\n').filter(line => line.trim());
    let summary = 'Operational data analyzed';
    let recommendation = 'Monitor conditions and adjust as needed';

    // Try to extract structured response
    for (const line of lines) {
      if (line.includes('summary') || line.match(/^\d+\./)) {
        summary = line.replace(/^\d+\.?\s*/, '').replace(/summary:?\s*/i, '').trim();
      } else if (line.includes('recommendation') || (summary !== 'Operational data analyzed' && line.trim())) {
        recommendation = line.replace(/^\d+\.?\s*/, '').replace(/recommendation:?\s*/i, '').trim();
        break;
      }
    }

    // Fallback parsing if structured format not found
    if (summary === 'Operational data analyzed' && lines.length >= 2) {
      summary = lines[0].replace(/^\d+\.?\s*/, '').trim();
      recommendation = lines[1].replace(/^\d+\.?\s*/, '').trim();
    }

    return {
      summary: summary.substring(0, 100), // Limit length
      recommendation: recommendation.substring(0, 150) // Limit length
    };

  } catch (error) {
    console.error('Error calling Claude API:', error);
    
    // Return contextual fallback based on the data
    let summary = 'Data analysis unavailable';
    let recommendation = 'Monitor key metrics and adjust operations as needed';

    // Generate basic insights based on data patterns
    if (data.weather.temp >= 100) {
      summary = 'Extreme heat conditions detected';
      recommendation = 'Consider shifting operations to cooler hours';
    } else if (data.energy.trend === 'up') {
      summary = 'Energy costs trending upward';
      recommendation = 'Optimize energy usage and consider off-peak scheduling';
    } else if (data.weather.alert !== 'none') {
      summary = 'Weather alert active';
      recommendation = 'Monitor weather conditions and prepare contingency plans';
    }

    return { summary, recommendation };
  }
}

/**
 * Main dashboard API handler that aggregates data from multiple sources
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse<DashboardResponse>) {
  try {
    // Check if this is a manual refresh request
    const isManualRefresh = req.query.refresh === 'true';

    // Fetch data from all sources concurrently
    const [production, energy, weather] = await Promise.allSettled([
      getProductionIndex(),
      getEnergyPrice(),
      getLocalWeather()
    ]);

    // Extract successful results or use fallback values
    const productionData: ProductionData = production.status === 'fulfilled' 
      ? production.value 
      : { index: 102.4, trend: '→ Data unavailable' };

    const energyData: EnergyData = energy.status === 'fulfilled' 
      ? energy.value 
      : { centsPerKwh: 12.5, trend: 'stable' };

    const weatherData: WeatherData = weather.status === 'fulfilled' 
      ? weather.value 
      : { temp: 75, alert: 'Weather data unavailable' };

    // Log any failures for monitoring
    if (production.status === 'rejected') {
      console.error('Production data fetch failed:', production.reason);
    }
    if (energy.status === 'rejected') {
      console.error('Energy data fetch failed:', energy.reason);
    }
    if (weather.status === 'rejected') {
      console.error('Weather data fetch failed:', weather.reason);
    }

    // Generate data hash for change detection
    const currentDataHash = generateDataHash(productionData, energyData, weatherData);

    // Check if we need to call Claude for new insights
    let insightData: InsightData;
    const needsNewInsight = isManualRefresh || cache.hasSignificantChange(currentDataHash);

    if (needsNewInsight) {
      console.log('Generating new insights with Claude AI...');
      insightData = await analyzeInsight({
        production: productionData,
        energy: energyData,
        weather: weatherData
      });
    } else {
      // Use cached insight if available
      const cachedInsight = cache.get('insight');
      insightData = cachedInsight?.data.insight || {
        summary: 'Using cached analysis',
        recommendation: 'Monitor conditions for changes'
      };
    }

    // Construct the response
    const responseData: DashboardResponse = {
      production: productionData,
      energy: energyData,
      weather: weatherData,
      insight: insightData
    };

    // Cache the complete response
    cache.set('dashboard', responseData, currentDataHash);
    if (needsNewInsight) {
      cache.set('insight', responseData, currentDataHash);
    }

    // Always return 200 with complete data
    res.status(200).json(responseData);

  } catch (error) {
    console.error('Dashboard API error:', error);

    // Return fallback data structure to ensure UI doesn't break
    const fallbackResponse: DashboardResponse = {
      production: { index: 102.4, trend: '→ Data unavailable' },
      energy: { centsPerKwh: 12.5, trend: 'stable' },
      weather: { temp: 75, alert: 'Data unavailable' },
      insight: {
        summary: 'System temporarily unavailable',
        recommendation: 'Please try refreshing in a few minutes'
      }
    };

    res.status(200).json(fallbackResponse);
  }
}