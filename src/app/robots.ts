import type { MetadataRoute } from 'next'

// Private tool for SFFD members: nothing here should be crawled or indexed.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      disallow: '/',
    },
  }
}
