export interface LanguageFiletypeEntry {
  languageId: string;
  extensions: string[];
  rootMarkers: string[];
}

function extOf(filePath: string): string {
  const idx = filePath.lastIndexOf('.');
  return idx >= 0 ? filePath.slice(idx).toLowerCase() : '';
}

function baseOf(filePath: string): string {
  return filePath.split('/').pop()?.toLowerCase() ?? '';
}

export const LSP_FILETYPES: readonly LanguageFiletypeEntry[] = [
  {
    languageId: 'typescript',
    extensions: ['.ts', '.tsx', '.mts', '.cts'],
    rootMarkers: [
      'tsconfig.json',
      'tsconfig.base.json',
      'package.json',
      'pnpm-workspace.yaml',
      'pnpm-lock.yaml',
      'yarn.lock',
      'package-lock.json',
      'bun.lockb',
      'bun.lock',
    ],
  },
  {
    languageId: 'javascript',
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
    rootMarkers: [
      'package.json',
      'jsconfig.json',
      'pnpm-lock.yaml',
      'yarn.lock',
      'package-lock.json',
      'bun.lockb',
      'bun.lock',
    ],
  },
  {
    languageId: 'python',
    extensions: ['.py', '.pyi'],
    rootMarkers: [
      'pyproject.toml',
      'setup.py',
      'setup.cfg',
      'requirements.txt',
      'Pipfile',
      'poetry.lock',
      'uv.lock',
      '.python-version',
    ],
  },
  {
    languageId: 'json',
    extensions: ['.json', '.jsonc', '.json5'],
    rootMarkers: [
      'package.json',
      'pnpm-lock.yaml',
      'yarn.lock',
      'package-lock.json',
      'bun.lockb',
      'bun.lock',
      '.git',
    ],
  },
  {
    languageId: 'html',
    extensions: ['.html', '.htm'],
    rootMarkers: [
      'package.json',
      'pnpm-lock.yaml',
      'yarn.lock',
      'package-lock.json',
      'bun.lockb',
      'bun.lock',
      '.git',
    ],
  },
  {
    languageId: 'css',
    extensions: ['.css', '.scss', '.sass', '.less'],
    rootMarkers: [
      'package.json',
      'pnpm-lock.yaml',
      'yarn.lock',
      'package-lock.json',
      'bun.lockb',
      'bun.lock',
      '.git',
    ],
  },
  {
    languageId: 'yaml',
    extensions: ['.yaml', '.yml'],
    rootMarkers: [
      'package.json',
      'pnpm-lock.yaml',
      'yarn.lock',
      'package-lock.json',
      'bun.lockb',
      'bun.lock',
      '.git',
      '.yamllint',
      'docker-compose.yml',
      'docker-compose.yaml',
      'compose.yaml',
      'Chart.yaml',
    ],
  },
  {
    languageId: 'dockerfile',
    extensions: ['Dockerfile'],
    rootMarkers: [
      'Dockerfile',
      '.dockerignore',
      'docker-compose.yml',
      'docker-compose.yaml',
      'compose.yml',
      'compose.yaml',
      '.git',
    ],
  },
  {
    languageId: 'dockercompose',
    extensions: [
      'compose.yaml',
      'compose.yml',
      'compose.override.yaml',
      'compose.override.yml',
      'docker-compose.yaml',
      'docker-compose.yml',
      'docker-compose.override.yaml',
      'docker-compose.override.yml',
    ],
    rootMarkers: [
      'compose.yaml',
      'compose.yml',
      'compose.override.yaml',
      'compose.override.yml',
      'docker-compose.yaml',
      'docker-compose.yml',
      'docker-compose.override.yaml',
      'docker-compose.override.yml',
      '.git',
    ],
  },
  {
    languageId: 'dockerbake',
    extensions: ['docker-bake.hcl', 'docker-bake.override.hcl'],
    rootMarkers: ['docker-bake.hcl', 'docker-bake.override.hcl', '.git'],
  },
  {
    languageId: 'shellscript',
    extensions: ['.sh', '.bash', '.zsh'],
    rootMarkers: [
      'package.json',
      'pnpm-lock.yaml',
      'yarn.lock',
      'package-lock.json',
      'bun.lockb',
      'bun.lock',
      '.git',
      '.editorconfig',
      '.shellcheckrc',
      '.shellcheck.json',
    ],
  },
  {
    languageId: 'rust',
    extensions: ['.rs'],
    rootMarkers: ['Cargo.toml', 'Cargo.lock'],
  },
  {
    languageId: 'go',
    extensions: ['.go'],
    rootMarkers: ['go.mod', 'go.sum', 'go.work'],
  },
  {
    languageId: 'java',
    extensions: ['.java'],
    rootMarkers: [
      'pom.xml',
      'build.gradle',
      'build.gradle.kts',
      'settings.gradle',
      'settings.gradle.kts',
      '.mvn',
      'gradlew',
    ],
  },
  {
    languageId: 'csharp',
    extensions: ['.cs'],
    rootMarkers: [
      '*.sln',
      '*.csproj',
      'global.json',
      'Directory.Build.props',
      'Directory.Build.targets',
      'NuGet.Config',
    ],
  },
  {
    languageId: 'ruby',
    extensions: ['.rb', '.rake'],
    rootMarkers: ['Gemfile', 'Gemfile.lock', '.ruby-version', 'Rakefile'],
  },
  {
    languageId: 'cpp',
    extensions: ['.cpp', '.cc', '.cxx', '.c', '.h', '.hpp', '.hxx'],
    rootMarkers: [
      'CMakeLists.txt',
      'compile_commands.json',
      'Makefile',
      'meson.build',
      '.clangd',
      'compile_flags.txt',
    ],
  },
  {
    languageId: 'kotlin',
    extensions: ['.kt', '.kts'],
    rootMarkers: [
      'build.gradle.kts',
      'settings.gradle.kts',
      'build.gradle',
      'settings.gradle',
      'gradlew',
    ],
  },
  {
    languageId: 'swift',
    extensions: ['.swift'],
    rootMarkers: ['Package.swift', 'Package.resolved', '*.xcodeproj', '*.xcworkspace'],
  },
  {
    languageId: 'php',
    extensions: ['.php'],
    rootMarkers: ['composer.json', 'composer.lock', 'artisan'],
  },
  {
    languageId: 'lua',
    extensions: ['.lua'],
    rootMarkers: ['.luarc.json', '.luacheckrc', 'stylua.toml', 'selene.toml'],
  },
  {
    languageId: 'dart',
    extensions: ['.dart'],
    rootMarkers: ['pubspec.yaml', 'pubspec.lock', '.dart_tool'],
  },
  {
    languageId: 'elixir',
    extensions: ['.ex', '.exs'],
    rootMarkers: ['mix.exs', 'mix.lock'],
  },
  {
    languageId: 'haskell',
    extensions: ['.hs', '.lhs'],
    rootMarkers: ['stack.yaml', 'cabal.project', '*.cabal', 'hie.yaml'],
  },
  {
    languageId: 'zig',
    extensions: ['.zig'],
    rootMarkers: ['build.zig', 'build.zig.zon'],
  },
];

const _extToLanguageId = new Map<string, string>();
const _languageIdToEntry = new Map<string, LanguageFiletypeEntry>();
const _nameToLanguageId = new Map<string, string>();

for (const entry of LSP_FILETYPES) {
  _languageIdToEntry.set(entry.languageId, entry);
  for (const ext of entry.extensions) {
    if (ext.startsWith('.')) {
      _extToLanguageId.set(ext.toLowerCase(), entry.languageId);
      continue;
    }
    _nameToLanguageId.set(ext.toLowerCase(), entry.languageId);
  }
}

export function getLanguageIdByExtension(ext: string): string | undefined {
  return _extToLanguageId.get(ext.toLowerCase());
}

export function getLanguageIdForFilePath(filePath: string): string | undefined {
  const name = baseOf(filePath);
  const byName = _nameToLanguageId.get(name);
  if (byName) return byName;
  return _extToLanguageId.get(extOf(filePath));
}

export function getRootMarkersForLanguage(languageId: string): string[] {
  return _languageIdToEntry.get(languageId)?.rootMarkers ?? [];
}

export function getRootMarkersForExtension(ext: string): string[] {
  const langId = _extToLanguageId.get(ext.toLowerCase());
  if (langId === undefined) return [];
  return _languageIdToEntry.get(langId)?.rootMarkers ?? [];
}

export function getRootMarkersForFilePath(filePath: string): string[] {
  const langId = getLanguageIdForFilePath(filePath);
  if (langId === undefined) return [];
  return _languageIdToEntry.get(langId)?.rootMarkers ?? [];
}

export function getAllRootMarkers(): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of LSP_FILETYPES) {
    for (const marker of entry.rootMarkers) {
      if (!seen.has(marker)) {
        seen.add(marker);
        result.push(marker);
      }
    }
  }
  return result;
}
