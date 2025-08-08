import { z } from 'zod';
import type { BotTool } from '../ToolRegistry';

// Example external API tool - Weather information
export const weatherTool: BotTool = {
  name: 'get_weather',
  description: 'Gets current weather information for a specified location',
  schema: z.object({
    location: z.string().describe('The city and state/country (e.g., "New York, NY" or "London, UK")'),
    units: z.enum(['metric', 'imperial', 'kelvin']).optional().describe('Temperature units (defaults to metric)'),
  }),
  execute: async (args: { location: string; units?: string }) => {
    // This is a mock implementation - in a real bot, you'd integrate with a weather API
    // like OpenWeatherMap, WeatherAPI, etc.
    
    const { location, units = 'metric' } = args;
    
    // Mock weather data
    const mockWeatherData = {
      location,
      temperature: units === 'imperial' ? '72°F' : units === 'kelvin' ? '295K' : '22°C',
      condition: 'Partly cloudy',
      humidity: '65%',
      windSpeed: units === 'imperial' ? '8 mph' : '13 km/h',
      description: `Current weather in ${location}`,
      lastUpdated: new Date().toISOString(),
    };
    
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500));
    
    return mockWeatherData;
  },
};

// Example tool for generating random facts
export const randomFactTool: BotTool = {
  name: 'random_fact',
  description: 'Generates a random interesting fact',
  schema: z.object({
    category: z.enum(['science', 'history', 'nature', 'technology', 'general']).optional().describe('Category of fact to generate'),
  }),
  execute: async (args: { category?: string }) => {
    const { category = 'general' } = args;
    
    const facts = {
      science: [
        'A group of flamingos is called a "flamboyance".',
        'Honey never spoils. Archaeologists have found honey in ancient Egyptian tombs that is still edible.',
        'A single cloud can weigh more than a million pounds.',
      ],
      history: [
        'The Great Wall of China is not visible from space with the naked eye.',
        'Napoleon was actually average height for his time period.',
        'The shortest war in history lasted only 38-45 minutes.',
      ],
      nature: [
        'Octopuses have three hearts and blue blood.',
        'Bananas are berries, but strawberries are not.',
        'There are more possible games of chess than atoms in the observable universe.',
      ],
      technology: [
        'The first computer bug was an actual bug - a moth trapped in a Harvard computer in 1947.',
        'More than 50% of all website traffic comes from mobile devices.',
        'The "@" symbol is called an "arobase" in French.',
      ],
      general: [
        'The human brain uses about 20% of the body\'s total energy.',
        'A group of owls is called a "parliament".',
        'The longest recorded flight of a chicken is 13 seconds.',
      ],
    };
    
    const categoryFacts = facts[category as keyof typeof facts] || facts.general;
    const randomFact = categoryFacts[Math.floor(Math.random() * categoryFacts.length)];
    
    return {
      fact: randomFact,
      category,
      source: 'Random Facts Database',
    };
  },
};