import { PROXY_ROTATION_NAMES, SESSION_MAX_USAGE_COUNTS } from "./consts.js";
import { PlaywrightCrawler } from "crawlee";
import { CraigslistPost, InputSchema, Search } from "./types.js";
import { validateInput, getRequestUrls } from "./validation.js";
import { Actor } from "apify";
import axios from "axios";

export class CrawlerSetup {
  name: string;
  search: Search;
  crawler!: PlaywrightCrawler | Promise<PlaywrightCrawler>;
  input: InputSchema;
  startUrls: string[];
  maxSessionUsageCount: number;
  maxPoolSize!: number;

  constructor(input: InputSchema) {
    this.input = input;
    this.name = "Craigslist Playwright Scraper";
    this.search = validateInput(input);
    this.startUrls = getRequestUrls(this.search);
    this.maxSessionUsageCount = SESSION_MAX_USAGE_COUNTS[input.proxyRotation]!;
    if (this.input.proxyRotation === PROXY_ROTATION_NAMES.UNTIL_FAILURE) {
      this.maxPoolSize = 1;
    }
  }

  async getCrawler(): Promise<PlaywrightCrawler> {
    if (this.input.healthcheck) {
      await axios.get(this.input.healthcheck).catch(() => {});
    }

    return new PlaywrightCrawler({
      maxConcurrency: this.input.maxConcurrency,
      maxRequestRetries: this.input.maxRequestRetries,
      maxRequestsPerCrawl: this.input.maxPagesPerCrawl,
      proxyConfiguration: await Actor.createProxyConfiguration(this.input.proxyConfiguration),
      useSessionPool: true,
      headless: true,
      requestHandler: async ({ page, request }) => {
        console.info(`Scraping: ${request.url}`);

        // Wait for the main results to load to avoid empty scrapes
        await page.waitForSelector(".result-node, .gallery-card", { timeout: 10000 }).catch(() => {
            console.warn("No result nodes found on page.");
        });

       // 1. Broaden the selector to include the modern Craigslist layout
        const posts = await page.$$eval(".cl-search-result, .result-node, .gallery-card", (elements) => {
          return elements.map((el) => {
            // 2. Use multiple possible selectors for titles and metadata
            const titleEl = el.querySelector(".titlestring, .cl-app-anchor, a.result-title");
            const metaEl = el.querySelector(".meta, .cl-search-result-meta, .result-meta");
            
            const title = titleEl?.textContent?.trim() || "";
            let url = titleEl?.getAttribute("href") || "";
            const metaHtml = metaEl?.innerHTML || "";

            // Ensure the URL is absolute
            if (url && !url.startsWith('http')) {
                const b = window.location.origin;
                url = new URL(url, b).href;
            }

            if (!title || !url || metaHtml.toLowerCase().includes("upcoming")) {
                return null;
            }

            return {
              url,
              description: title,
              created: new Date().toISOString(), 
            };
          }).filter(post => post !== null);
        });

            // Extract date: handling standard '13 mins ago' or date strings
            let dateVal = new Date().toISOString();
            if (metaHtml.includes("(")) {
                const datePart = metaHtml.split("(")[0].trim();
                const parsedDate = new Date(datePart);
                if (!isNaN(parsedDate.getTime())) {
                    dateVal = parsedDate.toISOString();
                }
            }

            return {
              url,
              description: title,
              created: dateVal,
            };
          }).filter(post => post !== null);
        });

        console.info(`Successfully parsed ${posts.length} listings.`);

        if (posts.length > 0) {
            await Actor.pushData(posts);

            if (this.input.externalAPI) {
                console.info(`Sending ${posts.length} posts to VPS...`);
                // Send as a batch to the VPS to be more efficient
                await axios.post(this.input.externalAPI, posts).catch((err) => {
                    console.error(`VPS Error: ${err.message}`);
                });
            }
        }
      },
    });
  }
}
