'use client';

import Image from 'next/image';
import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';

type FeatureCardProps = {
  title: string;
  description: string;
  eyebrow: string;
  icon: LucideIcon;
  imageSrc: string;
  imageAlt: string;
  delay?: number;
};

export default function FeatureCard({
  title,
  description,
  eyebrow,
  icon: Icon,
  imageSrc,
  imageAlt,
  delay = 0,
}: FeatureCardProps) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.55, delay }}
      className="group relative overflow-hidden rounded-[28px] border border-[var(--marketing-card-border)] bg-[var(--marketing-card-bg)] p-5 shadow-[var(--marketing-card-shadow)] backdrop-blur-md"
    >
      <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent opacity-70" />
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[0.7rem] font-bold uppercase tracking-[0.24em] text-[var(--marketing-muted)]">
            {eyebrow}
          </p>
          <h3 className="mt-2 font-display text-2xl font-bold tracking-tight text-[var(--marketing-heading)]">
            {title}
          </h3>
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/30 bg-primary/15 text-primary shadow-[0_12px_30px_rgba(244,162,97,0.16)]">
          <Icon className="h-5 w-5" />
        </div>
      </div>

      <p className="mb-5 text-sm leading-7 text-[var(--marketing-copy)]">
        {description}
      </p>

      <div className="relative overflow-hidden rounded-[22px] border border-white/10 bg-[var(--marketing-image-shell)]">
        <Image
          src={imageSrc}
          alt={imageAlt}
          width={960}
          height={720}
          className="h-52 w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          priority={false}
        />
      </div>
    </motion.article>
  );
}
