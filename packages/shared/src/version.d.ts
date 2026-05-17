declare const __APP_VERSION__: string;
declare const __APP_BUILD_VERSION__: string;
declare const __APP_BUILD_TIME__: string;
declare const __APP_GIT_HASH__: string;
declare const __APP_GIT_BRANCH__: string;
declare const __APP_GIT_TAG__: string;
declare const __APP_REPOSITORY_URL__: string;

interface BuildCommitInfo {
  shortHash: string;
  fullHash: string;
  date: string;
  author: string;
  subject: string;
}

declare const __APP_RECENT_COMMITS__: BuildCommitInfo[];
