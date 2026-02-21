import React from 'react';
import { cn } from '../../lib/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'bg-white rounded-[32px] shadow-[0_4px_20px_rgba(0,0,0,0.05)] overflow-hidden',
          className
        )}
        {...props}
      />
    );
  }
);
Card.displayName = 'Card';
