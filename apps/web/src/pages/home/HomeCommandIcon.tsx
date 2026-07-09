export type HomeCommandIconName = 'artifact' | 'plus' | 'team' | 'workflow';

interface HomeCommandIconProps {
  readonly icon: HomeCommandIconName;
}

export function HomeCommandIcon({ icon }: HomeCommandIconProps) {
  switch (icon) {
    case 'artifact':
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
          <path
            d="M5 7.5 12 4l7 3.5v8.8L12 20l-7-3.7V7.5Z"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.75"
          />
          <path
            d="M12 12 5.5 8.5M12 12l6.5-3.5M12 12v7"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.75"
          />
        </svg>
      );
    case 'plus':
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
          <path
            d="M12 5v14M5 12h14"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.75"
          />
        </svg>
      );
    case 'team':
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
          <path
            d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM4.5 19c.5-2.7 1.9-4 3.5-4s3 1.3 3.5 4M12.5 19c.5-2.7 1.9-4 3.5-4s3 1.3 3.5 4"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.75"
          />
        </svg>
      );
    case 'workflow':
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
          <path
            d="M6 7h4v4H6V7ZM14 13h4v4h-4v-4ZM10 9h2.5a3.5 3.5 0 0 1 3.5 3.5V13M14 15h-2.5A3.5 3.5 0 0 1 8 11.5V11"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.75"
          />
        </svg>
      );
  }
}
