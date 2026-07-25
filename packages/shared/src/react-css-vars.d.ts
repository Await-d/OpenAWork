import 'csstype';

declare module 'csstype' {
  interface Properties<_TLength = string | number, _TTime = string & {}> {
    [key: `--${string}`]: string | number | undefined;
  }
}

export {};
