import crypto from 'crypto';

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

interface InsightInput {
  production: ProductionData;
  energy: EnergyData;
  weather: WeatherData;
}

interface InsightResponse {
  summary: string;
  recommendation: string;
}

interface ClaudeMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ClaudeApiResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
  id: string;
  model: string;
  role: string;
  stop_reason: string;
  stop_sequence: null;
  type: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// Simple in-memory cache with TTL
class InsightCache {
  private cache = new Map<string, { data: InsightResponse; expires: number }>();
  private readonly CACHE_TTL = 30 * 60 * 1000; // 30 minutes in milliseconds

  set(key: string, data: InsightResponse) {
    this.cache.set(key, {
      data,
      expires: Date.now() + this.CACHE_TTL
    });
  }

  get(key: string): InsightResponse | null {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expires) {
      this.cache.delete(key);
      return null;
    }
    
    return item.data;
  }

  clear() {
    this.cache.clear();
  }
}

const cache = new InsightCache();

/**
 * Generates a consistent hash key from input data for caching purposes
 */
function generateDataHash(data: InsightInput): string {
  // Create a normalized representation of the data for consistent hashing
  const normalizedData = {
    production: {
      index: Math.round(data.production.index * 10) / 10, // Round to 1 decimal
      trend: data.production.trend
    },
    energy: {
      centsPerKwh: Math.round(data.energy.centsPerKwh * 100) / 100, // Round to 2 decimals
      trend: data.energy.trend
    },
    weather: {
      temp: Math.round(data.weather.temp / 5) * 5, // Round to nearest 5 degrees
      alert: data.weather.alert
    }
  };

  const dataString = JSON.stringify(normalizedData, Object.keys(normalizedData).sort());
  return crypto.createHash('md5').update(dataString).digest('hex');
}

/**
 * Validates that the input data contains all required properties
 */
function validateInputData(data: any): data is InsightInput {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const { production, energy, weather } = data;

  // Validate production data
  if (!production || typeof production.index !== 'number' || typeof production.trend !== 'string') {
    return false;
  }

  // Validate energy data
  if (!energy || typeof energy.centsPerKwh !== 'number' || !['up', 'down', 'stable'].includes(energy.trend)) {
    return false;
  }

  // Validate weather data
  if (!weather || typeof weather.temp !== 'number' || typeof weather.alert !== 'string') {
    return false;
  }

  return true;
}

/**
 * Parses Claude's response and validates the JSON structure
 */
function parseClaudeResponse(responseText: string): InsightResponse | null {
  try {
    // Try to extract JSON from the response
    let jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // If no JSON found, try to parse the entire response
      jsonMatch = [responseText];
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate the response structure
    if (typeof parsed.summary === 'string' && typeof parsed.recommendation === 'string') {
      return {
        summary: parsed.summary.trim().substring(0, 200), // Limit length
        recommendation: parsed.recommendation.trim().substring(0, 300) // Limit length
      };
    }

    return null;
  } catch (error) {
    console.error('Error parsing Claude response:', error);
    return null;
  }
}

/**
 * Analyzes operational data using Claude AI to generate insights and recommendations
 * 
 * @param data Object containing production, energy, and weather data
 * @returns Promise resolving to insight summary and recommendation
 * 
 * @example
 * ```typescript
 * const insight = await analyzeInsight({
 *   production: { index: 102.5, trend: "↑ 2.1% MoM" },
 *   energy: { centsPerKwh: 12.8, trend: "up" },
 *   weather: { temp: 95, alert: "none" }
 * });
 * console.log(insight.summary); // "Production strong, energy costs rising"
 * console.log(insight.recommendation); // "Consider energy optimization strategies"
 * ```
 */
export async function analyzeInsight(data: { production: any; energy: any; weather: any }): Promise<InsightResponse> {
  // Validate input data
  if (!validateInputData(data)) {
    console.error('Invalid input data provided to analyzeInsight');
    return {
      summary: "Invalid data provided for analysis.",
      recommendation: "Please ensure all required data fields are present and valid."
    };
  }

  // Generate cache key
  const dataHash = generateDataHash(data);
  
  // Check cache first
  const cachedInsight = cache.get(dataHash);
  if (cachedInsight) {
    return cachedInsight;
  }

  try {
    const claudeApiKey = process.env.CLAUDE_API_KEY;
    if (!claudeApiKey) {
      throw new Error('CLAUDE_API_KEY environment variable is required');
    }

    // Construct the prompt for Claude
    const systemMessage = "You are an operations advisor for manufacturing facilities. Analyze the provided operational data and respond with a JSON object containing exactly two keys: 'summary' and 'recommendation'. Keep responses concise and actionable.";
    
    const userMessage = `Analyze this manufacturing operations data for El Paso, TX:

Production Index: ${data.production.index} (${data.production.trend})
Energy Cost: ${data.energy.centsPerKwh}¢/kWh (trend: ${data.energy.trend})
Weather: ${data.weather.temp}°F (alert: ${data.weather.alert})

Respond with JSON format:
{
  "summary": "Brief analysis of current conditions (max 25 words)",
  "recommendation": "Specific actionable advice for operations (max 35 words)"
}

Focus on cost optimization, production efficiency, and weather-related operational adjustments.`;

    const messages: ClaudeMessage[] = [
      { role: 'user', content: userMessage }
    ];

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 300,
        system: systemMessage,
        messages: messages,
        temperature: 0.3 // Lower temperature for more consistent responses
      }),
      signal: AbortSignal.timeout(20000) // 20 second timeout
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Invalid Claude API key');
      }
      if (response.status === 429) {
        throw new Error('Claude API rate limit exceeded');
      }
      throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
    }

    const result: ClaudeApiResponse = await response.json();
    const content = result.content?.[0]?.text || '';

    // Parse and validate the response
    const parsedInsight = parseClaudeResponse(content);
    
    if (parsedInsight) {
      // Cache the successful result
      cache.set(dataHash, parsedInsight);
      return parsedInsight;
    } else {
      throw new Error('Invalid response format from Claude API');
    }

  } catch (error) {
    console.error('Error calling Claude API:', error);
    
    // Try to return cached insight from any previous successful call
    const anyCachedInsight = Array.from(cache['cache'].values())[0]?.data;
    if (anyCachedInsight) {
      return anyCachedInsight;
    }

    // Generate contextual fallback based on the data patterns
    let summary = "Data analysis temporarily unavailable";
    let recommendation = "Monitor key metrics and adjust operations as needed";

    // Provide basic insights based on data patterns
    if (data.weather.temp >= 100) {
      summary = "Extreme heat conditions detected";
      recommendation = "Consider shifting operations to cooler hours to reduce energy costs";
    } else if (data.energy.trend === 'up') {
      summary = "Energy costs trending upward";
      recommendation = "Optimize energy usage and consider off-peak scheduling";
    } else if (data.weather.alert !== 'none') {
      summary = "Weather alert active";
      recommendation = "Monitor weather conditions and prepare contingency plans";
    } else if (data.production.trend.includes('↓')) {
      summary = "Production index declining";
      recommendation = "Review production processes and identify improvement opportunities";
    } else if (data.production.trend.includes('↑')) {
      summary = "Production performing well";
      recommendation = "Maintain current efficiency while monitoring energy costs";
    }

    return {
      summary,
      recommendation
    };
  }
}

/**
 * Utility function to clear the insight cache
 * Useful for testing or forcing fresh analysis
 */
export function clearInsightCache(): void {
  cache.clear();
}

/**
 * Utility function to get cache statistics
 * Returns information about cached insights
 */
export function getInsightCacheStats(): { totalCached: number } {
  return {
    totalCached: cache['cache'].size
  };
}