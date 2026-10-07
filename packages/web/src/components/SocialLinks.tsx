import rawSocial from '@social';

/** The business's social media pages (ruling 50), each shown only once its link is filled in. */
const NAMES: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  x: 'X',
  linkedin: 'LinkedIn',
};

export function socialLinks(): Array<{ name: string; url: string }> {
  const links = (rawSocial as { links?: Record<string, unknown> }).links ?? {};
  return Object.entries(links)
    .filter(([, url]) => typeof url === 'string' && /^https:\/\//.test(url))
    .map(([key, url]) => ({ name: NAMES[key] ?? key, url: url as string }));
}

export function SocialLinks(): JSX.Element | null {
  const links = socialLinks();
  if (links.length === 0) return null;
  return (
    <nav aria-label="Follow us">
      <ul className="flex flex-wrap gap-2 list-none m-0 p-0">
        {links.map((link) => (
          <li key={link.name}>
            <a href={link.url} className="control px-0 text-paper underline" rel="noopener">
              {link.name}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
