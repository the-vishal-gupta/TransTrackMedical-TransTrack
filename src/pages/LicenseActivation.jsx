import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loader2, Key, Shield, ExternalLink, Mail, Clock, CheckCircle } from 'lucide-react';

export default function LicenseActivation({ onActivated }) {
  const [licenseKey, setLicenseKey] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [licenseInfo, setLicenseInfo] = useState(null);

  useEffect(() => {
    loadLicenseInfo();
  }, []);

  const loadLicenseInfo = async () => {
    if (window.electronAPI) {
      try {
        const info = await window.electronAPI.license.getInfo();
        setLicenseInfo(info);
      } catch (e) {
        console.error('Failed to load license info:', e);
      }
    }
  };

  const handleActivate = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      if (window.electronAPI) {
        await window.electronAPI.license.activate(licenseKey, {
          organization: organizationName,
          activatedAt: new Date().toISOString(),
        });
        
        if (onActivated) {
          onActivated();
        }
        
        window.location.reload();
      }
    } catch (err) {
      setError(err.message || 'Failed to activate license. Please check your license key.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleContinueEvaluation = () => {
    if (onActivated) {
      onActivated();
    }
  };

  const formatLicenseKey = (value) => {
    // Remove non-alphanumeric characters and convert to uppercase
    const cleaned = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    
    // Add dashes every 5 characters
    const parts = [];
    for (let i = 0; i < cleaned.length && i < 25; i += 5) {
      parts.push(cleaned.substring(i, i + 5));
    }
    
    return parts.join('-');
  };

  const handleKeyChange = (e) => {
    setLicenseKey(formatLicenseKey(e.target.value));
  };

  const isEvaluationExpired = licenseInfo?.evaluationExpired;
  const daysRemaining = licenseInfo?.evaluationDaysRemaining || 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-cyan-50 via-slate-50 to-cyan-100 flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        {/* Logo and Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-cyan-600 rounded-2xl mb-4 shadow-lg">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900">TransTrack</h1>
          <p className="text-slate-600 mt-2">Commercial License Required</p>
        </div>

        <Card className="border-slate-200 shadow-xl">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-xl text-center flex items-center justify-center gap-2">
              <Key className="w-5 h-5" />
              License Activation
            </CardTitle>
            <CardDescription className="text-center">
              Enter your license key to activate TransTrack
            </CardDescription>
          </CardHeader>
          
          <CardContent>
            {/* Evaluation Status */}
            {!licenseInfo?.isLicensed && (
              <div className={`mb-6 p-4 rounded-lg border ${
                isEvaluationExpired 
                  ? 'bg-red-50 border-red-200' 
                  : 'bg-amber-50 border-amber-200'
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  <Clock className={`w-4 h-4 ${isEvaluationExpired ? 'text-red-600' : 'text-amber-600'}`} />
                  <span className={`font-medium ${isEvaluationExpired ? 'text-red-700' : 'text-amber-700'}`}>
                    {isEvaluationExpired ? 'Evaluation Expired' : 'Evaluation Mode'}
                  </span>
                </div>
                <p className={`text-sm ${isEvaluationExpired ? 'text-red-600' : 'text-amber-600'}`}>
                  {isEvaluationExpired 
                    ? 'Your 14-day evaluation has expired. Please purchase a license to continue using TransTrack.'
                    : `${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} remaining in your evaluation period.`
                  }
                </p>
              </div>
            )}

            {licenseInfo?.isLicensed && (
              <div className="mb-6 p-4 rounded-lg bg-green-50 border border-green-200">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <span className="font-medium text-green-700">License Active</span>
                  <Badge className="ml-auto bg-green-100 text-green-700 capitalize">
                    {licenseInfo.type}
                  </Badge>
                </div>
                <p className="text-sm text-green-600">
                  License: {licenseInfo.key}
                </p>
              </div>
            )}

            <form onSubmit={handleActivate} className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="organization">Organization Name</Label>
                <Input
                  id="organization"
                  type="text"
                  placeholder="Your Hospital or Clinic Name"
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                  required
                  disabled={isLoading}
                  className="h-11"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="licenseKey">License Key</Label>
                <Input
                  id="licenseKey"
                  type="text"
                  placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
                  value={licenseKey}
                  onChange={handleKeyChange}
                  required
                  disabled={isLoading}
                  className="h-11 font-mono tracking-wider"
                  maxLength={29}
                />
                <p className="text-xs text-slate-500">
                  Enter the 25-character license key from your purchase confirmation.
                </p>
              </div>

              <Button
                type="submit"
                className="w-full h-11 bg-cyan-600 hover:bg-cyan-700"
                disabled={isLoading || licenseKey.length < 29}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Activating...
                  </>
                ) : (
                  <>
                    <Key className="w-4 h-4 mr-2" />
                    Activate License
                  </>
                )}
              </Button>
            </form>

            {/* Continue Evaluation Button */}
            {!isEvaluationExpired && !licenseInfo?.isLicensed && (
              <div className="mt-4">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleContinueEvaluation}
                >
                  Continue Evaluation ({daysRemaining} days left)
                </Button>
              </div>
            )}
          </CardContent>

          <CardFooter className="flex flex-col gap-4 pt-4 border-t">
            <div className="text-center w-full">
              <p className="text-sm text-slate-600 mb-2">Don't have a license?</p>
              <div className="flex gap-2 justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open('mailto:NicMGildehaus83@outlook.com?subject=TransTrack%20License%20Purchase', '_blank')}
                >
                  <Mail className="w-4 h-4 mr-2" />
                  Purchase License
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open('mailto:NicMGildehaus83@outlook.com?subject=TransTrack%20Inquiry', '_blank')}
                >
                  <Mail className="w-4 h-4 mr-2" />
                  Contact Sales
                </Button>
              </div>
            </div>

            {/* Pricing Info */}
            <div className="w-full text-center text-xs text-slate-500 space-y-1">
              <p className="font-medium">Pricing starts at $2,499</p>
              <p>Starter | Professional | Enterprise</p>
            </div>
          </CardFooter>
        </Card>

        {/* Compliance Footer */}
        <div className="mt-6 text-center">
          <div className="flex items-center justify-center gap-3 text-xs text-slate-500">
            <span className="px-2 py-1 bg-white rounded border border-slate-200">HIPAA</span>
            <span className="px-2 py-1 bg-white rounded border border-slate-200">FDA 21 CFR Part 11</span>
            <span className="px-2 py-1 bg-white rounded border border-slate-200">AATB</span>
          </div>
        </div>
      </div>
    </div>
  );
}
