import { PROXY_ROTATION_NAMES, SESSION_MAX_USAGE_COUNTS } from "./consts.js";
import { PlaywrightCrawler } from "crawlee";
import { strict as assert } from "assert";
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
      proxyConfiguration: await Actor.createProxyConfiguration(
        this.input.proxyConfiguration
      ),
      useSessionPool: true,
      sessionPoolOptions: {
        maxPoolSize: this.maxPoolSize,
        sessionOptions: {
          maxUsageCount: this.maxSessionUsageCount,
        },
      },
      headless: true,
      requestHandler: async ({ page, request }) => {
        console.log(`Scraping ${await page.title()} | ${request.url}`);

        const titles = await page.$$eval(".titlestring", (els) => {
          return els.map((el) => el.textContent?.trim() || "");
        });

        const urls = await page.$$eval(".titlestring", (els) => {
          return els.map((el) => el.getAttribute("href") || "");
        });

        const dates = await page.$$eval(".meta", (els) => {
          return els.map((el) => {
            // FIX: Changed getInnerHTML() to innerHTML
            let ih = el.innerHTML; 
            let ub = ih.search(/\(/);
            // Attempt to parse the date string found between the metadata
            try {
                let dateStr = ih.substring(13, ub - 1).trim();
                let created = new Date(dateStr);
                return created.toISOString(); 
            } catch (e) {
                return new Date().toISOString();
            }
          });
        });

        try {
          assert.equal(titles.length, urls.length, `Titles and URLs count mismatch`);
          assert.equal(urls.length, dates.length, `URLs and Dates count mismatch`);
        } catch (AssertionError) {
          console.warn(`${AssertionError}`);
        }

        const posts: CraigslistPost[] = [];
        for (let i = 0; i < titles.length; i++) {
          posts.push({
            url: urls[i],
            description: titles[i],
            created: dates[i],
          });
        }

        console.info(`Found ${posts.length} posts on this page.`);
        await Actor.pushData(posts);

        // Send to VPS backend
        if (this.input.externalAPI) {
            for (const post of posts) {
                await axios.post(this.input.externalAPI, post).catch((err) => {
                    console.error(`Failed to send post to VPS: ${err.message}`);
                });
            }
        }
      },
    });
  }
}
