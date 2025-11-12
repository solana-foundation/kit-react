import { createContext, type ReactNode, useContext, useState } from 'react';

import { cn } from '../../lib/utils';

type TabsContext = Readonly<{
	activeValue: string;
	setActiveValue(next: string): void;
}>;

const TabsContext = createContext<TabsContext | null>(null);

function useTabsContext(): TabsContext {
	const context = useContext(TabsContext);
	if (!context) {
		throw new Error('Tabs components must be used within <Tabs>.');
	}
	return context;
}

type TabsProps = Readonly<{
	children: ReactNode;
	className?: string;
	defaultValue: string;
}>;

export function Tabs({ children, className, defaultValue }: TabsProps) {
	const [activeValue, setActiveValue] = useState(defaultValue);
	return (
		<TabsContext.Provider value={{ activeValue, setActiveValue }}>
			<div className={cn('space-y-4', className)}>{children}</div>
		</TabsContext.Provider>
	);
}

type TabsListProps = Readonly<{
	children: ReactNode;
	className?: string;
}>;

export function TabsList({ children, className }: TabsListProps) {
	return (
		<div
			className={cn(
				'inline-flex flex-wrap gap-2 rounded-full border border-border/70 bg-card/70 p-1 text-sm font-medium',
				className,
			)}
		>
			{children}
		</div>
	);
}

type TabsTriggerProps = Readonly<{
	children: ReactNode;
	className?: string;
	value: string;
}>;

export function TabsTrigger({ children, className, value }: TabsTriggerProps) {
	const { activeValue, setActiveValue } = useTabsContext();
	const isActive = activeValue === value;
	return (
		<button
			type="button"
			onClick={() => setActiveValue(value)}
			data-state={isActive ? 'active' : 'inactive'}
			className={cn(
				'rounded-full px-4 py-1.5 transition focus-visible:ring-2 focus-visible:ring-ring/40',
				isActive
					? 'bg-primary text-primary-foreground shadow-sm'
					: 'text-muted-foreground hover:text-foreground',
				className,
			)}
		>
			{children}
		</button>
	);
}

type TabsContentProps = Readonly<{
	children: ReactNode;
	className?: string;
	value: string;
}>;

export function TabsContent({ children, className, value }: TabsContentProps) {
	const { activeValue } = useTabsContext();
	if (activeValue !== value) {
		return null;
	}
	return <div className={cn('space-y-6', className)}>{children}</div>;
}
