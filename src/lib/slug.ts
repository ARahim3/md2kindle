// GitHub-flavoured heading slugifier so that in-document anchor links
// (`[jump](#my-heading)`) resolve to the ids we assign to headings.

export function slugify(text: string): string {
  const base = text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'section';
}

export function uniqueSlug(base: string, used: Set<string>): string {
  let slug = base;
  let i = 1;
  while (used.has(slug)) slug = `${base}-${++i}`;
  used.add(slug);
  return slug;
}
