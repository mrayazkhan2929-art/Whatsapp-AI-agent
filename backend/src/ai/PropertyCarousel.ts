import { PropertyMatcher, type DualSourceResult, type PropertyMatch } from '../properties/PropertyMatcher.js'
import { ComparisonEngine } from '../properties/ComparisonEngine.js'

export class PropertyCarousel {
  private readonly matcher = new PropertyMatcher()

  format(result: DualSourceResult, language: 'en' | 'ar' = 'en'): string {
    return this.matcher.formatCarousel(result.properties, language)
  }

  compare(properties: PropertyMatch[], language: 'en' | 'ar' = 'en'): string {
    return ComparisonEngine.compareProperties(properties, language)
  }
}
