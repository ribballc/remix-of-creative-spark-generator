import { useState, useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface RecentCreative {
  id: string;
  image_url: string;
  created_at: string;
}

export function RecentCreativesGallery() {
  const [creatives, setCreatives] = useState<RecentCreative[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchCreatives = async () => {
    try {
      const { data, error } = await supabase
        .from('generated_creatives')
        .select('id, image_url, created_at')
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) {
        console.error('Error fetching creatives:', error);
        return;
      }

      setCreatives(data || []);
    } catch (error) {
      console.error('Failed to fetch creatives:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCreatives();

    // Set up realtime subscription for new creatives
    const channel = supabase
      .channel('generated_creatives_changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'generated_creatives'
        },
        () => {
          // Refetch when new creative is added
          fetchCreatives();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  if (isLoading) {
    return (
      <div className="mt-12 pt-8 border-t border-border">
        <div className="flex items-center gap-2 mb-6">
          <Sparkles className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">Recent Creatives</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {[...Array(5)].map((_, i) => (
            <div 
              key={i}
              className="aspect-[9/16] rounded-xl bg-secondary/50 border border-border animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  if (creatives.length === 0) {
    return (
      <div className="mt-12 pt-8 border-t border-border">
        <div className="flex items-center gap-2 mb-6">
          <Sparkles className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">Recent Creatives</h3>
        </div>
        
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {[...Array(5)].map((_, i) => (
            <div 
              key={i}
              className="aspect-[9/16] rounded-xl bg-secondary/50 border border-dashed border-border flex items-center justify-center"
            >
              <span className="text-xs text-muted-foreground text-center px-2">
                {i === 0 ? 'Your creatives will appear here' : ''}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-12 pt-8 border-t border-border">
      <div className="flex items-center gap-2 mb-6">
        <Sparkles className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-semibold text-foreground">Recent Creatives</h3>
        <span className="text-sm text-muted-foreground">({creatives.length})</span>
      </div>
      
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {creatives.map((creative) => (
          <div 
            key={creative.id}
            className="aspect-[9/16] rounded-xl overflow-hidden bg-secondary border border-border hover:border-primary/50 transition-all duration-300 hover:scale-[1.02] cursor-pointer group"
          >
            <img 
              src={creative.image_url} 
              alt="Generated creative"
              className="w-full h-full object-cover group-hover:opacity-90 transition-opacity"
              loading="lazy"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// Keep these exports for backward compatibility but they're no longer used
export function saveCreativeToHistory(_imageUrl: string) {
  // No-op - saving is now handled by the edge function
}

export function getRecentCreatives() {
  return [];
}
