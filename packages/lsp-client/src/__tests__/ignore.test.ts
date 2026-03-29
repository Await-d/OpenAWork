import { describe, it, expect } from 'vitest';
import { getLanguageId } from '../language.js';

describe('language extension coverage', () => {
  it('covers C/C++ extensions', () => {
    expect(getLanguageId('/src/main.c')).toBe('c');
    expect(getLanguageId('/src/main.cpp')).toBe('cpp');
    expect(getLanguageId('/src/main.h')).toBe('c');
    expect(getLanguageId('/src/main.hpp')).toBe('cpp');
  });

  it('covers C#', () => {
    expect(getLanguageId('/src/Program.cs')).toBe('csharp');
  });

  it('covers Java and Kotlin', () => {
    expect(getLanguageId('/src/Main.java')).toBe('java');
    expect(getLanguageId('/src/Main.kt')).toBe('kotlin');
    expect(getLanguageId('/src/build.kts')).toBe('kotlin');
  });

  it('covers shell scripts', () => {
    expect(getLanguageId('/scripts/run.sh')).toBe('shellscript');
    expect(getLanguageId('/scripts/run.bash')).toBe('shellscript');
    expect(getLanguageId('/scripts/run.zsh')).toBe('shellscript');
  });

  it('covers Rust', () => {
    expect(getLanguageId('/src/lib.rs')).toBe('rust');
  });

  it('covers Vue and Svelte', () => {
    expect(getLanguageId('/src/App.vue')).toBe('vue');
    expect(getLanguageId('/src/App.svelte')).toBe('svelte');
  });

  it('covers GraphQL', () => {
    expect(getLanguageId('/schema.graphql')).toBe('graphql');
    expect(getLanguageId('/schema.gql')).toBe('graphql');
  });

  it('covers SQL', () => {
    expect(getLanguageId('/migrations/001.sql')).toBe('sql');
  });

  it('covers Terraform', () => {
    expect(getLanguageId('/infra/main.tf')).toBe('terraform');
    expect(getLanguageId('/infra/vars.tfvars')).toBe('terraform');
  });

  it('covers TOML', () => {
    expect(getLanguageId('/Cargo.toml')).toBe('toml');
  });

  it('covers XML and HTML', () => {
    expect(getLanguageId('/index.html')).toBe('html');
    expect(getLanguageId('/config.xml')).toBe('xml');
  });
});
