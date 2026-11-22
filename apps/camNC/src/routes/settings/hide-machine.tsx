import { t as translate } from '@wbcnc/i18n';
import { PageHeader } from '@/components/page-header';
import { isDepthBlendSupported } from '@/depth/depthBlendManager';
import { useDepthSettings, useSetDepthSettings } from '@/store/store';
import { zodResolver } from '@hookform/resolvers/zod';
import { ClientOnly, createFileRoute } from '@tanstack/react-router';
import { Alert, AlertDescription, AlertTitle } from '@wbcnc/ui/components/alert';
import { Button } from '@wbcnc/ui/components/button';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@wbcnc/ui/components/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@wbcnc/ui/components/select';
import { Slider } from '@wbcnc/ui/components/slider';
import { toast } from '@wbcnc/ui/components/sonner';
import { useForm } from 'react-hook-form';
import z from 'zod';

export const Route = createFileRoute('/settings/hide-machine')({
  component: HideMachineComponent,
});

function HideMachineComponent() {
  return <HideMachineSettings />;
}

const fpsOptions: { label: string; value: number }[] = [
  { label: translate('Every 5 s'), value: 0.2 },
  { label: translate('Every 2 s'), value: 0.5 },
  { label: translate('1 fps'), value: 1 },
  { label: translate('2 fps'), value: 2 },
  { label: translate('5 fps'), value: 5 },
  { label: translate('10 fps'), value: 10 },
];

const defaultSettings = {
  frameRateLimit: 1,
  bgMargin: 20,
  renderMargin: 5,
  minMaskVal: 0.1,
  thresholdOffset: 0.2,
};

const schema = z.object({
  frameRateLimit: z.number().min(0.01),
  bgMargin: z.number().min(0).max(75),
  renderMargin: z.number().min(0).max(75),
  minMaskVal: z.number().min(0).max(0.5),
  thresholdOffset: z.number().min(0).max(1),
});

function HideMachineSettings() {
  const depthSettings = useDepthSettings();
  const setDepthSettings = useSetDepthSettings();

  const form = useForm<z.infer<typeof schema>>({
    defaultValues: {
      ...depthSettings,
    },
    resolver: zodResolver(schema),
  });

  function onSubmit(data: z.infer<typeof schema>) {
    setDepthSettings(data);
    toast.success(translate('Depth settings saved'));
  }

  function handleReset() {
    form.reset(defaultSettings);
  }

  return (
    <div className="w-full h-full">
      <PageHeader title={translate('Hide-Machine Settings')} />
      <div className="container mx-auto max-w-xl py-6 space-y-6">
        <ClientOnly>
          {!isDepthBlendSupported() && (
            <Alert variant="destructive">
              <AlertTitle>{translate('WebGPU not supported')}</AlertTitle>
              <AlertDescription>{translate('This feature requires WebGPU, which is not supported by your browser yet.')}</AlertDescription>
            </Alert>
          )}
        </ClientOnly>
        <p className="text-sm text-muted-foreground">
          {translate(
            'This experimental feature estimates monocular depth using the Depth Anything V2 model to mask objects above the work surface and "hide" the machine (only tested with the'
          )}{' '}
          <a href="https://docs.v1e.com/lowrider/" target="_blank" rel="noreferrer" className="underline">
            {translate('LowRider V4 beam ')}
          </a>
          {translate('). The algorithm assumes the largest depth cluster is the table and masks everything above a configurable offset. ')}
        </p>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* FPS throttle */}
            <FormField
              control={form.control}
              name="frameRateLimit"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{translate('Depth Estimation Interval')}</FormLabel>
                  <FormControl>
                    <Select value={field.value.toString()} onValueChange={v => field.onChange(parseFloat(v))}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {fpsOptions.map(opt => (
                          <SelectItem key={opt.value} value={opt.value.toString()}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormDescription>{translate('Throttle frame rate to reduce (GPU) load')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Background Margin */}
            <FormField
              control={form.control}
              name="bgMargin"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Slider
                      label={translate('Background Mask Margin')}
                      value={field.value}
                      onChange={v => field.onChange(v)}
                      minValue={0}
                      maxValue={75}
                      step={1}
                    />
                  </FormControl>
                  <FormDescription>
                    {translate('Margin to add around mask when computing background to avoid artifacts from shadows etc. ')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Render Margin */}
            <FormField
              control={form.control}
              name="renderMargin"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Slider
                      label={translate('Render Mask Margin')}
                      value={field.value}
                      onChange={v => field.onChange(v)}
                      minValue={0}
                      maxValue={75}
                      step={1}
                    />
                  </FormControl>
                  <FormDescription>
                    {translate('Margin to add around mask when rendering to avoid artifacts from edges of the mask.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Minimum Mask Value */}
            <FormField
              control={form.control}
              name="minMaskVal"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Slider
                      label={translate('Minimum Mask Opacity')}
                      value={field.value}
                      onChange={v => field.onChange(v)}
                      minValue={0}
                      maxValue={0.5}
                      step={0.01}
                    />
                  </FormControl>
                  <FormDescription>{translate('Machine will always be visible with at least this opacity.')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Offset above table */}
            <FormField
              control={form.control}
              name="thresholdOffset"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Slider
                      label={translate('Relative Offset Above Table to Mask')}
                      value={field.value}
                      onChange={v => field.onChange(v)}
                      minValue={0}
                      maxValue={1}
                      step={0.01}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex gap-2">
              <Button type="submit">{translate('Save')}</Button>
              <Button type="button" variant="secondary" onClick={handleReset}>
                {translate('Reset to Defaults ')}
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
}
