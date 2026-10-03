import type { Analysis } from './analysis';

export interface Tweet {
  text: string;
  publishedAt: string;
  url: string;
  tweetId?: string;
}

export interface ScrapedTimeline {
  tweets: Tweet[];
  coverageComplete: boolean;
  oldestOrdinaryPublishedAt: string;
}

export interface StoredTweet extends Analysis {
  id: string;
  tweet_url: string;
  tweet_text: string;
  published_at: string;
  scraped_at: string;
  created_at: string;
}
