interface WeatherResponse {
  main: {
    temp: number;
    feels_like: number;
    temp_min: number;
    temp_max: number;
    pressure: number;
    humidity: number;
  };
  weather: Array<{
    id: number;
    main: string;
    description: string;
    icon: string;
  }>;
  alerts?: Array<{
    sender_name: string;
    event: string;
    start: number;
    end: number;
    description: string;
    tags: string[];
  }>;
  name: string;
  cod: number;
}

interface WeatherData {
  temp: number;
  alert: string;
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
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes in milliseconds
const CACHE_KEY = 'el_paso_weather';

// El Paso, TX coordinates
const EL_PASO_LAT = 31.7619;
const EL_PASO_LON = -106.4850;

/**
 * Fetches current weather data for El Paso, TX from OpenWeatherMap API
 * 
 * @returns Promise<WeatherData> Object containing temperature in Fahrenheit and any active weather alerts
 * @throws Error when API key is missing or API request fails
 * 
 * @example
 * ```typescript
 * const weather = await getLocalWeather();
 * console.log(`Current temp: ${weather.temp}°F, Alert: ${weather.alert}`);
 * ```
 */
export async function getLocalWeather(): Promise<WeatherData> {
  // Check cache first
  const cachedData = cache.get(CACHE_KEY);
  if (cachedData) {
    return cachedData;
  }

  const apiKey = process.env.WEATHER_API_KEY;
  if (!apiKey) {
    throw new Error('WEATHER_API_KEY environment variable is required');
  }

  try {
    // OpenWeatherMap Current Weather API endpoint
    const url = 'https://api.openweathermap.org/data/2.5/weather';
    const params = new URLSearchParams({
      lat: EL_PASO_LAT.toString(),
      lon: EL_PASO_LON.toString(),
      appid: apiKey,
      units: 'imperial', // Fahrenheit
      lang: 'en'
    });

    const response = await fetch(`${url}?${params}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'OpsIntel-Dashboard/1.0'
      },
      // 10 second timeout
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Invalid OpenWeatherMap API key');
      }
      if (response.status === 429) {
        throw new Error('OpenWeatherMap API rate limit exceeded. Please try again later.');
      }
      if (response.status === 404) {
        throw new Error('Location not found in OpenWeatherMap API');
      }
      throw new Error(`OpenWeatherMap API error: ${response.status} ${response.statusText}`);
    }

    const data: WeatherResponse = await response.json();
    
    if (!data.main?.temp) {
      throw new Error('Invalid weather data received from API');
    }

    const temperature = Math.round(data.main.temp);
    
    if (isNaN(temperature)) {
      throw new Error('Invalid temperature value received');
    }

    // Check for weather alerts
    let alertMessage = "none";
    
    // Check if there are any severe weather conditions
    if (data.weather && data.weather.length > 0) {
      const mainWeather = data.weather[0];
      
      // Check for severe weather conditions based on weather IDs
      // OpenWeatherMap weather condition IDs: https://openweathermap.org/weather-conditions
      const severeWeatherIds = [
        200, 201, 202, 210, 211, 212, 221, 230, 231, 232, // Thunderstorms
        502, 503, 504, 511, 522, 531, // Heavy rain
        602, 622, // Heavy snow
        711, 721, 731, 741, 751, 761, 762, 771, 781 // Atmospheric conditions
      ];
      
      if (severeWeatherIds.includes(mainWeather.id)) {
        alertMessage = `${mainWeather.main}: ${mainWeather.description}`;
      }
      
      // Check for extreme temperatures
      if (temperature >= 100) {
        alertMessage = "Extreme heat warning";
      } else if (temperature <= 32) {
        alertMessage = "Freezing temperature alert";
      }
    }

    // Additional check for alerts from the API response (if available)
    if (data.alerts && data.alerts.length > 0) {
      // Use the first active alert
      const activeAlert = data.alerts[0];
      alertMessage = activeAlert.event || activeAlert.description || "Weather alert active";
    }

    const result: WeatherData = {
      temp: temperature,
      alert: alertMessage
    };

    // Cache the result
    cache.set(CACHE_KEY, result, CACHE_TTL);
    
    return result;

  } catch (error) {
    console.error('Error fetching weather data:', error);
    
    // Return fallback data in case of error
    return {
      temp: 75,
      alert: "Weather data unavailable"
    };
  }
}

/**
 * Utility function to clear the weather cache
 * Useful for testing or forcing fresh data retrieval
 */
export function clearWeatherCache(): void {
  cache.get(CACHE_KEY) && cache.set(CACHE_KEY, null, 0);
}

/**
 * Utility function to get cache status
 * Returns whether cached data exists and when it expires
 */
export function getWeatherCacheStatus(): { cached: boolean; expiresAt?: Date } {
  const item = cache.get(CACHE_KEY);
  return {
    cached: !!item,
    expiresAt: item ? new Date(Date.now() + CACHE_TTL) : undefined
  };
}