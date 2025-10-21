import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Button } from '~/components/ui/button';
import { Label } from '~/components/ui/label';
import { Input } from '~/components/ui/input';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { R2Bucket } from '~/types';

interface BucketConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bucket?: R2Bucket;
  initialData?: Partial<Omit<R2Bucket, 'id' | 'createdAt' | 'updatedAt'>>;
  onSave: (bucket: Omit<R2Bucket, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
}

const validateAccessKeyId = (value: string): string | undefined => {
  const cleaned = value.replace(/[\s-]/g, '').trim();
  
  if (cleaned.length !== 32) {
    return `Access Key ID must be exactly 32 characters (currently ${cleaned.length})`;
  }
  if (!/^[a-zA-Z0-9]+$/.test(cleaned)) {
    return 'Access Key ID must contain only letters and numbers';
  }
  return undefined;
};

const validateSecretAccessKey = (value: string): string | undefined => {
  const cleaned = value.replace(/\s/g, '').trim();
  
  if (cleaned.length !== 64) {
    return `Secret Access Key must be exactly 64 characters (currently ${cleaned.length})`;
  }
  if (!/^[a-zA-Z0-9+/]+$/.test(cleaned)) {
    return 'Secret Access Key contains invalid characters';
  }
  return undefined;
};

const validateEndpoint = (value: string): string | undefined => {
  const cleaned = value.replace(/['"]/g, '').trim();
  
  if (!cleaned.startsWith('https://')) {
    return 'Endpoint must start with https://';
  }
  if (!cleaned.endsWith('.r2.cloudflarestorage.com')) {
    return 'Endpoint must end with .r2.cloudflarestorage.com';
  }
  try {
    new URL(cleaned);
  } catch {
    return 'Invalid URL format';
  }
  return undefined;
};

const validateBucketName = (value: string): string | undefined => {
  const cleaned = value.trim();
  
  if (cleaned.length < 3 || cleaned.length > 63) {
    return 'Bucket name must be between 3 and 63 characters';
  }
  if (!/^[a-z0-9]/.test(cleaned)) {
    return 'Bucket name must start with a lowercase letter or number';
  }
  if (!/[a-z0-9]$/.test(cleaned)) {
    return 'Bucket name must end with a lowercase letter or number';
  }
  if (/--/.test(cleaned)) {
    return 'Bucket name cannot contain consecutive hyphens';
  }
  if (!/^[a-z0-9-]+$/.test(cleaned)) {
    return 'Bucket name can only contain lowercase letters, numbers, and hyphens';
  }
  return undefined;
};

export default function BucketConfigDialog({
  open,
  onOpenChange,
  bucket,
  initialData,
  onSave
}: BucketConfigDialogProps) {
  const [formData, setFormData] = useState<Omit<R2Bucket, 'id' | 'createdAt' | 'updatedAt'>>({
    name: '',
    accessKeyId: '',
    secretAccessKey: '',
    endpoint: 'https://YOUR-ACCOUNT-ID.r2.cloudflarestorage.com',
    bucketName: '',
    region: 'auto',
    isActive: false
  });

  const [validationErrors, setValidationErrors] = useState<{
    name?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    endpoint?: string;
    bucketName?: string;
  }>({});

  const [isSaving, setIsSaving] = useState(false);
  const [showValidationMessage, setShowValidationMessage] = useState(false);
  const [attemptedSave, setAttemptedSave] = useState(false);
  const [isPlaceholderSecret, setIsPlaceholderSecret] = useState(false);

  const SECRET_PLACEHOLDER = '••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••';

  useEffect(() => {
    if (bucket) {
      // Edit mode - use placeholder for secret
      setFormData({
        name: bucket.name,
        accessKeyId: bucket.accessKeyId,
        secretAccessKey: SECRET_PLACEHOLDER,
        endpoint: bucket.endpoint,
        bucketName: bucket.bucketName,
        region: bucket.region || 'auto',
      });
      setIsPlaceholderSecret(true);
    } else if (initialData) {
      // Duplicate mode - use placeholder for secret
      setFormData({
        name: initialData.name || '',
        accessKeyId: initialData.accessKeyId || '',
        secretAccessKey: SECRET_PLACEHOLDER,
        endpoint: initialData.endpoint || 'https://YOUR-ACCOUNT-ID.r2.cloudflarestorage.com',
        bucketName: initialData.bucketName || '',
        region: initialData.region || 'auto',
      });
      setIsPlaceholderSecret(true);
    } else {
      // New mode - empty form
      setFormData({
        name: '',
        accessKeyId: '',
        secretAccessKey: '',
        endpoint: 'https://YOUR-ACCOUNT-ID.r2.cloudflarestorage.com',
        bucketName: '',
        region: 'auto',
      });
      setIsPlaceholderSecret(false);
    }
    setValidationErrors({});
    setShowValidationMessage(false);
    setAttemptedSave(false);
  }, [bucket, initialData, open]);

  const cleanAndValidateField = (field: keyof typeof formData, value: string) => {
    let cleaned = value;
    let error: string | undefined;

    switch (field) {
      case 'accessKeyId':
        cleaned = value.replace(/[\s-]/g, '').trim();
        error = validateAccessKeyId(cleaned);
        break;
      case 'secretAccessKey':
        // If user starts typing, clear placeholder flag
        if (isPlaceholderSecret && value !== SECRET_PLACEHOLDER) {
          setIsPlaceholderSecret(false);
        }
        cleaned = value.replace(/\s/g, '').trim();
        error = validateSecretAccessKey(cleaned);
        break;
      case 'endpoint':
        cleaned = value.replace(/['"]/g, '').trim();
        if (cleaned && !cleaned.startsWith('http')) {
          cleaned = 'https://' + cleaned;
        }
        error = validateEndpoint(cleaned);
        break;
      case 'bucketName':
        cleaned = value.trim().toLowerCase();
        error = validateBucketName(cleaned);
        break;
    }

    // If updating bucketName, also update name to match
    if (field === 'bucketName') {
      setFormData(prev => ({ ...prev, [field]: cleaned, name: cleaned }));
    } else {
      setFormData(prev => ({ ...prev, [field]: cleaned }));
    }
    setValidationErrors(prev => ({ ...prev, [field]: error }));
  };

  const isFormValid = (): boolean => {
    return !Object.values(validationErrors).some(error => error) &&
           formData.accessKeyId.length > 0 &&
           formData.secretAccessKey.length > 0 &&
           formData.endpoint.length > 0 &&
           formData.bucketName.length > 0;
  };

  const handleSave = async () => {
    setAttemptedSave(true);

    // Validate all fields
    const errors: typeof validationErrors = {};
    if (!formData.accessKeyId) errors.accessKeyId = 'Access Key ID is required';
    else if (formData.accessKeyId.replace(/[\s-]/g, '').length !== 32) {
      errors.accessKeyId = validateAccessKeyId(formData.accessKeyId);
    }

    // Skip secret validation if using placeholder (edit mode without changing secret)
    if (!isPlaceholderSecret) {
      if (!formData.secretAccessKey) errors.secretAccessKey = 'Secret Access Key is required';
      else if (formData.secretAccessKey.replace(/\s/g, '').length !== 64) {
        errors.secretAccessKey = validateSecretAccessKey(formData.secretAccessKey);
      }
    }

    if (!formData.endpoint) errors.endpoint = 'R2 Endpoint is required';
    else {
      const endpointError = validateEndpoint(formData.endpoint);
      if (endpointError) errors.endpoint = endpointError;
    }

    if (!formData.bucketName) errors.bucketName = 'Bucket Name is required';
    else {
      const bucketError = validateBucketName(formData.bucketName);
      if (bucketError) errors.bucketName = bucketError;
    }

    setValidationErrors(errors);

    if (Object.keys(errors).length > 0) {
      setShowValidationMessage(true);
      setTimeout(() => setShowValidationMessage(false), 3000);
      return;
    }

    setIsSaving(true);
    try {
      // Prepare data to save
      const dataToSave = { ...formData };

      // If using placeholder secret, omit it from the data
      // - Edit mode: keeps existing encrypted value in database
      // - Duplicate mode: backend will copy secret from existing bucket with matching accessKeyId
      if (isPlaceholderSecret) {
        delete (dataToSave as any).secretAccessKey;
      }

      await onSave(dataToSave);
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to save bucket:', error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{bucket ? 'Edit Bucket' : 'Add New Bucket'}</DialogTitle>
          <DialogDescription>
            Configure your Cloudflare R2 bucket credentials and settings
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="accessKeyId">
                Access Key ID<span className="text-red-500 ml-1">*</span>
                <span className="text-xs text-muted-foreground ml-2">
                  ({formData.accessKeyId.replace(/[\s-]/g, '').length}/32)
                </span>
              </Label>
              <Input
                id="accessKeyId"
                type="text"
                value={formData.accessKeyId}
                onChange={(e) => cleanAndValidateField('accessKeyId', e.target.value)}
                placeholder="32-character Access Key ID"
                className={attemptedSave && validationErrors.accessKeyId ? 'border-red-500 focus-visible:ring-red-500/50' : ''}
              />
              {attemptedSave && validationErrors.accessKeyId && (
                <p className="text-xs text-red-500">{validationErrors.accessKeyId}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="secretAccessKey">
                Secret Access Key<span className="text-red-500 ml-1">*</span>
                {!isPlaceholderSecret && (
                  <span className="text-xs text-muted-foreground ml-2">
                    ({formData.secretAccessKey.replace(/\s/g, '').length}/64)
                  </span>
                )}
              </Label>
              <Input
                id="secretAccessKey"
                type="password"
                value={formData.secretAccessKey}
                onChange={(e) => cleanAndValidateField('secretAccessKey', e.target.value)}
                placeholder={isPlaceholderSecret ? "Leave unchanged or enter new secret" : "64-character Secret Access Key"}
                className={attemptedSave && validationErrors.secretAccessKey ? 'border-red-500 focus-visible:ring-red-500/50' : ''}
              />
              {isPlaceholderSecret && (
                <p className="text-xs text-muted-foreground">
                  Leave as-is to keep existing secret, or enter a new one
                </p>
              )}
              {attemptedSave && validationErrors.secretAccessKey && (
                <p className="text-xs text-red-500">{validationErrors.secretAccessKey}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="endpoint">R2 Endpoint<span className="text-red-500 ml-1">*</span></Label>
            <Input
              id="endpoint"
              type="text"
              value={formData.endpoint}
              onChange={(e) => cleanAndValidateField('endpoint', e.target.value)}
              placeholder="https://YOUR-ACCOUNT-ID.r2.cloudflarestorage.com"
              className={attemptedSave && validationErrors.endpoint ? 'border-red-500 focus-visible:ring-red-500/50' : ''}
            />
            {attemptedSave && validationErrors.endpoint ? (
              <p className="text-xs text-red-500">{validationErrors.endpoint}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Found in your Cloudflare R2 dashboard
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="bucketName">
                R2 Bucket Name<span className="text-red-500 ml-1">*</span>
                {formData.bucketName && (
                  <span className="text-xs text-muted-foreground ml-2">
                    ({formData.bucketName.length} characters)
                  </span>
                )}
              </Label>
              <Input
                id="bucketName"
                type="text"
                value={formData.bucketName}
                onChange={(e) => cleanAndValidateField('bucketName', e.target.value)}
                placeholder="my-backup-bucket"
                className={attemptedSave && validationErrors.bucketName ? 'border-red-500 focus-visible:ring-red-500/50' : ''}
              />
              {attemptedSave && validationErrors.bucketName && (
                <p className="text-xs text-red-500">{validationErrors.bucketName}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="region">Region (Optional)</Label>
              <Input
                id="region"
                type="text"
                value={formData.region || ''}
                onChange={(e) => setFormData({ ...formData, region: e.target.value })}
                placeholder="auto"
              />
            </div>
          </div>

        </div>

        <DialogFooter>
          <div className="flex items-center flex-1">
            {showValidationMessage && (
              <div className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                Please fill in all required fields
              </div>
            )}
          </div>
          <Button 
            variant="destructive" 
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button 
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              bucket ? 'Update Bucket' : 'Add Bucket'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}