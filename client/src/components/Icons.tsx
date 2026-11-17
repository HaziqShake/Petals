import React from 'react';

interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
  color?: string;
}

// 5-petal cherry blossom — sourced from Twemoji (CC-BY 4.0, Twitter/X)
// https://github.com/twitter/twemoji
export const PetalIcon = ({ size = 24, ...props }: IconProps) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" width={size} height={size} {...props}>
    <path fill="#F4ABBA" d="M31.298 20.807c4.197-1.363 5.027-3.182 4.191-6.416-.952.308-2.105-.001-2.272-.518-.168-.513.581-1.443 1.533-1.753-1.223-3.107-2.964-4.089-7.161-2.727-1.606.522-3.238 1.492-4.655 2.635C23.582 10.327 24 8.475 24 6.786c0-4.412-1.473-5.765-4.807-5.968 0 1-.652 2-1.193 2s-1.194-1-1.194-2C13.472 1.021 12 2.374 12 6.786c0 1.689.417 3.541 1.066 5.241-1.416-1.142-3.049-2.111-4.655-2.633-4.197-1.364-5.938-.381-7.162 2.727.951.31 1.701 1.238 1.534 1.753-.167.515-1.32.826-2.271.518-.837 3.233-.005 5.052 4.19 6.415 1.606.521 3.497.697 5.314.605-1.524.994-2.95 2.247-3.943 3.613-2.594 3.57-2.197 5.53.381 7.654.588-.809 1.703-1.235 2.142-.917.438.317.378 1.511-.21 2.32 2.816 1.795 4.803 1.565 7.396-2.003.993-1.366 1.743-3.111 2.218-4.867.475 1.757 1.226 3.501 2.218 4.867 2.594 3.57 4.58 3.798 7.397 2.003-.587-.81-.649-2.002-.21-2.321.437-.317 1.553.107 2.142.917 2.577-2.123 2.973-4.083.381-7.653-.993-1.366-2.42-2.619-3.943-3.613 1.816.092 3.706-.084 5.313-.605zM18 20.337c-.162-.292-.353-.538-.588-.709-.234-.171-.528-.276-.856-.341.228-.244.403-.502.493-.778.09-.275.1-.587.059-.919.302.141.602.228.892.228s.59-.087.894-.229c-.041.332-.031.644.059.919.09.276.265.534.492.778-.327.065-.621.17-.855.341-.236.172-.428.418-.59.71z"/>
    <path fill="#EA596E" d="M22.012 25.566c.932-.592 2.168-.317 2.762.614.593.932.318 2.168-.614 2.762-.932.593-2.168.318-2.762-.614-.592-.932-.318-2.168.614-2.762zM14.55 13.841c-.932.593-2.168.319-2.761-.613-.593-.932-.318-2.168.614-2.761.932-.593 2.168-.318 2.761.613.593.932.318 2.168-.614 2.761zm1.92 10.918c1.078.241 1.758 1.31 1.52 2.388-.24 1.078-1.308 1.758-2.387 1.519-1.079-.24-1.758-1.309-1.519-2.387.239-1.079 1.308-1.758 2.386-1.52zm3.037-13.665c-1.078-.239-1.758-1.308-1.518-2.386.239-1.078 1.308-1.758 2.386-1.519 1.078.24 1.759 1.308 1.519 2.386-.241 1.079-1.309 1.758-2.387 1.519zm-6.013 10.53c.592.933.317 2.169-.614 2.763-.932.593-2.168.318-2.762-.615-.593-.931-.318-2.167.613-2.761.933-.592 2.169-.318 2.763.613zm9.339-5.943c-.593-.932-.317-2.168.614-2.761.932-.593 2.168-.318 2.761.614s.317 2.168-.613 2.761c-.933.593-2.169.318-2.762-.614zm.795 4.524c.24-1.079 1.309-1.759 2.387-1.52 1.078.24 1.758 1.309 1.519 2.387-.24 1.078-1.309 1.758-2.387 1.518-1.079-.238-1.758-1.307-1.519-2.385zm-12.69-2.821c-.24 1.079-1.308 1.758-2.386 1.519-1.078-.24-1.758-1.309-1.519-2.387.239-1.078 1.308-1.758 2.386-1.519 1.079.241 1.758 1.309 1.519 2.387z"/>
    <circle fill="#FFCC4D" cx="18" cy="18.818" r="4"/>
  </svg>
);

export const HeartIcon = ({ size = 20, color = 'currentColor', fill = 'none', ...props }: IconProps & { fill?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78v0z" />
  </svg>
);

export const NoteIcon = ({ size = 22, color = 'currentColor', ...props }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);

export const CameraIcon = ({ size = 22, color = 'currentColor', ...props }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <rect x="3" y="4" width="18" height="14" rx="2" ry="2" />
    <circle cx="12" cy="11" r="3" />
    <path d="M7 4V2h4l2 2" />
  </svg>
);

export const TrashIcon = ({ size = 18, color = 'currentColor', ...props }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

export const PlusIcon = ({ size = 24, color = 'currentColor', ...props }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export const EditIcon = ({ size = 18, color = 'currentColor', ...props }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

export const ChatIcon = ({ size = 22, color = 'currentColor', ...props }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
);

export const BellIcon = ({ size = 22, color = 'currentColor', ...props }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

export const DownloadIcon = ({ size = 20, color = 'currentColor', ...props }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V15" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

export const CloseIcon = ({ size = 18, color = 'currentColor', ...props }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export const CheckIcon = ({ size = 18, color = 'currentColor', ...props }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const ImageIcon = ({ size = 22, color = 'currentColor', ...props }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
);

export const FilmIcon = ({ size = 22, color = 'currentColor', ...props }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
    <line x1="7" y1="2" x2="7" y2="22" />
    <line x1="17" y1="2" x2="17" y2="22" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <line x1="2" y1="7" x2="7" y2="7" />
    <line x1="2" y1="17" x2="7" y2="17" />
    <line x1="17" y1="17" x2="22" y2="17" />
    <line x1="17" y1="7" x2="22" y2="7" />
  </svg>
);

export const PlayIcon = ({ size = 16, color = 'currentColor', ...props }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none" {...props}>
    <polygon points="6 3 20 12 6 21 6 3" />
  </svg>
);

export const EyeIcon = ({ size = 22, color = 'currentColor', ...props }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const SunIcon = ({ size = 22, color = 'currentColor', ...props }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" />
    <line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" />
    <line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
);

export const MoonIcon = ({ size = 22, color = 'currentColor', ...props }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

export const DotIcon = ({ size = 18, color = 'currentColor', ...props }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none" {...props}>
    <circle cx="12" cy="12" r="8" />
  </svg>
);


