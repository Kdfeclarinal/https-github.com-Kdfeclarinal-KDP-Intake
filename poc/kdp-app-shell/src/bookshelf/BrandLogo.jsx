import React from 'react';
import companyLogo from '../assets/2017_expert_authority_effect_logo_TRANS (1).png';

const h = React.createElement;

export function BrandLogo({ className = '' }) {
  return h('img', {
    className: `kdp-brand-logo${className ? ` ${className}` : ''}`,
    src: companyLogo,
    alt: 'The Expert Authority Effect',
    width: 2083,
    height: 2083,
  });
}
