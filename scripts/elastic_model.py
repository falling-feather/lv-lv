"""3D linear-elastic Rayleigh–Ritz model of an idealized almond bell.

The variational energy is the standard isotropic elasticity weak form.
Cartesian Legendre trial fields include six rigid motions; volume quadrature
integrates the actual remaining wall. Both stiffness and mass change on cutting.
This is a documented numerical teaching model, not an artifact reconstruction.
"""
from dataclasses import dataclass
from functools import lru_cache
import argparse
import json
from pathlib import Path
import time
import hashlib
from itertools import product

import numpy as np
from numpy.polynomial.legendre import legvander, legval, legder, leggauss

A, B, HEIGHT = .075, .045, .16
WALL, STEP, WALL_BIAS, MAX_CUTS = .0045, .00015, -.23, 5
MOUTH_RISE = .012
RADIUS = (A*A+B*B)/(2*B)
CENTER = RADIUS-B
ALPHA = np.arcsin(A/RADIUS)
DEGREE, Z_DEGREE = 11, 5


@dataclass(frozen=True)
class Material:
    young: float = 1e11
    poisson: float = .34
    density: float = 8800.


def zone_weights(angle,u):
    angle,u=np.broadcast_arrays(angle,u)
    band=np.exp(-((u-.66)/.22)**4)
    return np.stack((band*np.sin(angle)**8,band*np.sin(2*angle)**8,
                     np.exp(-((u-.94)/.09)**4)),axis=-1)


def wall_at(angle, u, cut_a, cut_b, cut_c):
    return WALL*(1+WALL_BIAS*np.cos(4*angle))-STEP*(
        zone_weights(angle,u)*np.array([cut_a,cut_b,cut_c])).sum(axis=-1)


def contour(t, sign):
    return np.stack((RADIUS*np.sin(t), sign*(RADIUS*np.cos(t)-CENTER)), axis=-1)


def scale_at(u):
    return .76+.24*(.4*u+.6*u*u)+.025*np.sin(np.pi*u)


def height_at(xy):
    angle=np.arctan2(xy[...,1]/B,xy[...,0]/A)
    return HEIGHT-MOUTH_RISE*np.sin(angle)**2


@lru_cache(maxsize=6)
def quadrature(order=(32, 20, 3)):
    t, wt = leggauss(order[0])
    z, wz = leggauss(order[1])
    r, wr = leggauss(order[2])
    t, wt = t*ALPHA, wt*ALPHA
    u, wz = (z+1)/2, wz/2*HEIGHT
    r, wr = (r+1)/2, wr/2
    tt, uu, rr = np.meshgrid(t, u, r, indexing='ij')
    w = (wt[:,None,None]*wz[None,:,None]*wr[None,None,:]).ravel()
    return tt.ravel(), uu.ravel(), rr.ravel(), w


def integration_points(cut_a, cut_b, cut_c, order=(32,20,3)):
    t,u,r,w = quadrature(order)
    points, weights = [], []
    for sign in (1,-1):
        p = contour(t,sign)
        radius = np.linalg.norm(p,axis=1)
        angle = np.arctan2(p[:,1]/B,p[:,0]/A)
        thick = wall_at(angle,u,cut_a,cut_b,cut_c)
        if np.min(thick) <= 0:
            raise ValueError('non-positive wall thickness')
        s = scale_at(u)-(1-r)*thick/radius
        xy = p*s[:,None]
        # Terms from derivatives of radial thickness cancel in this determinant.
        jac = s*thick/radius*(RADIUS**2-CENTER*RADIUS*np.cos(t))
        heights=height_at(p)
        points.append(np.column_stack((xy,u*heights)))
        weights.append(w*jac*heights/HEIGHT)
    return np.concatenate(points), np.concatenate(weights)


def indices(degree=DEGREE, z_degree=Z_DEGREE):
    return [(p,q,r) for p in range(degree+1) for q in range(degree+1-p)
            for r in range(z_degree+1)]


def basis(points, degree=DEGREE, z_degree=Z_DEGREE):
    x,y,u = points[:,0]/A,points[:,1]/B,points[:,2]/HEIGHT
    vs = [legvander(x,degree),legvander(y,degree),legvander(2*u-1,z_degree)]
    ds=[]
    for vals,n in ((x,degree),(y,degree),(2*u-1,z_degree)):
        ds.append(np.column_stack([legval(vals,legder(np.eye(n+1)[j]))
                                  for j in range(n+1)]))
    ns=[]
    gs=[]
    for p,q,r in indices(degree,z_degree):
        xx,yy,zz=vs[0][:,p],vs[1][:,q],vs[2][:,r]
        ns.append(xx*yy*zz)
        gs.append(np.column_stack((ds[0][:,p]*yy*zz/A,
                                   xx*ds[1][:,q]*zz/B,
                                   xx*yy*2*ds[2][:,r]/HEIGHT)))
    return np.stack(ns,axis=1),np.stack(gs,axis=1)


def stiffness_mass(cut_a,cut_b,cut_c,degree=DEGREE,z_degree=Z_DEGREE,
                   material=Material(),order=(32,20,3)):
    xyz,w=integration_points(cut_a,cut_b,cut_c,order)
    n,g=basis(xyz,degree,z_degree)
    mu=material.young/(2*(1+material.poisson))
    lam=material.young*material.poisson/((1+material.poisson)*(1-2*material.poisson))
    gg=[[g[:,:,a].T@(w[:,None]*g[:,:,b]) for b in range(3)] for a in range(3)]
    trace=sum(gg[i][i] for i in range(3))
    k=np.block([[mu*gg[b][a]+lam*gg[a][b]+(mu*trace if a==b else 0)
                 for b in range(3)] for a in range(3)])
    m=np.kron(np.eye(3),n.T@((material.density*w)[:,None]*n))
    return (k+k.T)/2,(m+m.T)/2


@lru_cache(maxsize=12)
def projection(degree,z_degree):
    """One fixed, mass-orthogonal trial space for the entire cutting domain.

    Thin walls make high Cartesian polynomials nearly dependent. Preserve all
    affine fields exactly (therefore every rigid motion), then discard only
    near-dependent residual directions once at the uncut reference geometry.
    Reusing this projector prevents state-dependent rank changes.
    """
    _,full_mass=stiffness_mass(0,0,0,degree,z_degree)
    ns=full_mass.shape[0]//3
    mass=full_mass[:ns,:ns]
    ix=indices(degree,z_degree)
    affine=np.eye(ns)[:,[ix.index(v) for v in ((0,0,0),(1,0,0),(0,1,0),(0,0,1))]]
    l=np.linalg.cholesky(affine.T@mass@affine)
    low=affine@np.linalg.inv(l.T)
    remainder=np.eye(ns)-low@(low.T@mass)
    gram=remainder.T@mass@remainder
    vals,vecs=np.linalg.eigh((gram+gram.T)/2)
    keep=vals>vals[-1]*1e-9
    high=remainder@(vecs[:,keep]/np.sqrt(vals[keep]))
    return np.kron(np.eye(3),np.column_stack((low,high)))


def solve(cut_a,cut_b,cut_c,degree=DEGREE,z_degree=Z_DEGREE,
          material=Material(),order=(32,20,3),count=12):
    k,m=stiffness_mass(cut_a,cut_b,cut_c,degree,z_degree,material,order)
    p=projection(degree,z_degree)
    k,m=p.T@k@p,p.T@m@p
    l=np.linalg.cholesky(m)
    left=np.linalg.solve(l,k)
    reduced=np.linalg.solve(l,left.T).T
    vals,vectors=np.linalg.eigh((reduced+reduced.T)/2)
    if vals[6] <= 0 or np.max(np.abs(vals[:6])) > vals[6]*1e-6:
        raise ValueError('expected exactly six free-body rigid modes')
    vals,vectors=vals[6:6+count],vectors[:,6:6+count]
    coeff=p@np.linalg.solve(l.T,vectors)
    return np.sqrt(vals)/(2*np.pi),coeff


def surface(cut_a,cut_b,cut_c,nt=48,nz=16):
    t=np.concatenate((np.linspace(-ALPHA,ALPHA,nt//2,endpoint=False),
                      np.linspace(ALPHA,-ALPHA,nt//2,endpoint=False)))
    sign=np.concatenate((np.ones(nt//2),-np.ones(nt//2)))
    xy=contour(t,sign)
    angle=np.arctan2(xy[:,1]/B,xy[:,0]/A)
    rings,inner=[],[]
    thickness=[]
    for u in np.linspace(0,1,nz+1):
        thick=wall_at(angle,u,cut_a,cut_b,cut_c)
        outer=xy*scale_at(u)
        inset=outer-xy/np.linalg.norm(xy,axis=1)[:,None]*thick[:,None]
        heights=height_at(xy)
        rings.append(np.column_stack((outer,u*heights)))
        inner.append(np.column_stack((inset,u*heights)))
        thickness.extend(thick.tolist())
    return np.array(rings),np.array(inner),float(min(thickness))


def geometry(cut_a,cut_b,cut_c):
    rings,inner,thick=surface(cut_a,cut_b,cut_c)
    _,w=integration_points(cut_a,cut_b,cut_c)
    return {'rings':rings.tolist(),'inner':inner.tolist(),
            'volume':float(w.sum()),'min_thickness':thick}


def sample_modes(coeff,points,degree=DEGREE,z_degree=Z_DEGREE):
    n,_=basis(np.asarray(points),degree,z_degree)
    return np.einsum('pn,cnm->pmc',n,coeff.reshape(3,n.shape[1],-1))


def strike_points():
    # Front centre and lower side corner of the strike field (idealized placement).
    ts=np.array([0,ALPHA*.62])
    xy=contour(ts,1)*scale_at(np.array([.75,.83]))[:,None]
    pts=np.column_stack((xy,np.array([.75,.83])*height_at(contour(ts,1))))
    normals=np.column_stack((np.sin(ts),np.cos(ts),np.zeros(2)))
    return pts,normals


def inspect():
    f,c=solve(0,0,0)
    pts,normals=strike_points()
    weights=np.abs(np.einsum('pmc,pc->pm',sample_modes(c,pts),normals))
    for j in range(len(f)):
        print(j,round(float(f[j]),3),np.round(weights[:,j],4).tolist())


def output_path(value):
    root=Path(__file__).resolve().parents[1]
    path=(root/Path(value)).resolve()
    if not path.is_relative_to(root) or '\ufffd' in str(path):
        raise ValueError('output must stay inside the verified project workspace')
    path.parent.mkdir(parents=True,exist_ok=True)
    return path


def check(output):
    report={}
    for cuts in ((0,0,0),(3,3,3),(MAX_CUTS,)*3):
        f,_=solve(*cuts)
        refined,_=solve(*cuts,order=(48,30,4))
        report[':'.join(map(str,cuts))]={'hz':np.round(f[:2],5).tolist(),
                           'quadratureDifferenceCents':np.round(1200*np.log2(refined[:2]/f[:2]),5).tolist()}
    result={'quadratureChecks':report,
            'materialNote':'E=100 GPa, nu=.34, rho=8800 kg/m3 are nominal design assumptions, not measured artifact parameters.'}
    output_path(output).write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result),flush=True)


def identify_modes(f,c,degree=DEGREE):
    pts,normals=strike_points()
    responses=np.abs(np.einsum('pmc,pc->pm',sample_modes(c,pts,degree=degree),normals))
    selected=tuple(int(np.argmax(responses[i,:2])) for i in range(2))
    if selected[0]==selected[1]:
        raise ValueError('strike locations do not identify complementary modes')
    ring=surface(0,0,0)[0][12]
    radial=ring.copy();radial[:,2]=0;radial/=np.linalg.norm(radial,axis=1)[:,None]
    fields=sample_modes(c[:,selected],ring,degree=degree)
    nodes=[]
    for i in range(2):
        values=np.einsum('pc,pc->p',fields[:,i,:],radial)
        signs=np.sign(values[np.abs(values)>np.max(np.abs(values))*1e-5])
        nodes.append(int(np.count_nonzero(signs!=np.roll(signs,1))))
    if nodes!=[4,4]: raise ValueError(f'expected four-lobe modes: {nodes}')
    return selected,responses,nodes


def generate(output):
    started=time.perf_counter()
    f0,c0=solve(0,0,0)
    _,m0=stiffness_mass(0,0,0)
    selected,responses,nodes=identify_modes(f0,c0)
    base=c0[:,selected]
    pts,normals=strike_points()
    g0=geometry(0,0,0)
    outer=np.array(g0['rings']).reshape(-1,3)
    initial_inner=np.array(g0['inner']).reshape(-1,3)
    offsets=[]
    for axis in range(3):
        cuts=[0,0,0];cuts[axis]=1
        inner=np.array(geometry(*cuts)['inner']).reshape(-1,3)
        offsets.append(np.round(inner-initial_inner,9).ravel().tolist())
    states=[];fields=[];residuals=[]
    for cuts in product(range(MAX_CUTS+1),repeat=3):
        f,c=solve(*cuts)
        mac=np.abs(base.T@m0@c)**2/(np.diag(base.T@m0@base)[:,None]*np.diag(c.T@m0@c)[None,:])
        _,ia,ib=max((mac[0,i]+mac[1,j],i,j) for i in range(len(f)) for j in range(len(f)) if i!=j)
        picked=[ia,ib]
        if min(mac[0,ia],mac[1,ib])<.8: raise ValueError(f'mode tracking failed: {cuts}')
        g=geometry(*cuts)
        if g['min_thickness']<=.002: raise ValueError(f'wall domain exceeded: {cuts}')
        disp=sample_modes(c[:,picked],outer)
        for j in range(2): disp[:,j,:]/=np.max(np.linalg.norm(disp[:,j,:],axis=1))
        fields.append(np.rint(disp.transpose(1,0,2).reshape(2,-1)*32767).astype('<i2').tobytes())
        strike=sample_modes(c,pts)
        amp=np.abs(np.einsum('pmc,pc->pm',strike,normals))/f[None,:]
        amp/=amp.sum(axis=1,keepdims=True)
        if cuts in ((0,0,0),(3,3,3),(MAX_CUTS,)*3):
            k,m=stiffness_mass(*cuts);p=projection(DEGREE,Z_DEGREE)
            rr=p.T@(k@c[:,picked]-(m@c[:,picked])*(2*np.pi*f[picked])**2)
            residuals.append(float(np.max(np.linalg.norm(rr,axis=0)/np.linalg.norm(p.T@k@c[:,picked],axis=0))))
        states.append({'index':len(states),'id':':'.join(map(str,cuts)),'cuts':list(cuts),
                       'frequencies':np.round(f[picked],6).tolist(),'partials':np.round(f,6).tolist(),
                       'weights':np.round(amp,7).tolist(),'modeIndices':picked,
                       'massKg':round(g['volume']*Material().density,6),
                       'minWallMm':round(g['min_thickness']*1000,4),
                       'mac':[round(float(mac[0,ia]),6),round(float(mac[1,ib]),6)]})
        if len(states)%36==0: print(f'calculated {len(states)}/216 states',flush=True)
    comparisons=[]
    for degree in (9,10):
        fr,cr=solve(0,0,0,degree=degree)
        sr,_,_=identify_modes(fr,cr,degree)
        comparisons.append({'degree':degree,'hz':fr[list(sr)].tolist(),
                            'relativeToCurrent':(fr[list(sr)]/f0[list(selected)]-1).tolist()})
    output=output_path(output)
    binary=output.with_suffix('.modes.bin')
    binary_tmp=binary.with_suffix('.tmp')
    binary_tmp.write_bytes(b''.join(fields));binary_tmp.replace(binary)
    model={'method':'3D linear-elastic Rayleigh-Ritz teaching approximation',
           'basis':{'xyDegree':DEGREE,'zDegree':Z_DEGREE,'retainedDofs':projection(DEGREE,Z_DEGREE).shape[1]},
           'boundary':'free vibration, six rigid modes removed; attachments omitted',
           'material':Material().__dict__,'materialStatus':'nominal design assumptions, not artifact measurements',
           'dimensions':{'halfWidth':A,'halfDepth':B,'height':HEIGHT,'mouthRise':MOUTH_RISE},
           'wallBias':WALL_BIAS,'quadrature':[32,20,3],
           'modeIdentification':{'baseIndices':selected,'radialSignChanges':nodes,'strikeResponses':responses[:,:2].tolist()},
           'basisRefinement':{'comparisons':comparisons,'currentHz':f0[list(selected)].tolist(),
                              'status':'not certified converged; no claim of artifact pitch accuracy'},
           'maxSampledProjectedEigenResidual':max(residuals),'residualSampleCount':len(residuals)}
    model['revision']=hashlib.sha256(json.dumps({'states':states,'dimensions':model['dimensions']},sort_keys=True).encode()).hexdigest()[:16]
    data={'schema':2,'model':model,'nt':48,'nz':16,'stepMm':STEP*1000,'maxCuts':MAX_CUTS,
          'zoneNames':['鼓部内壁','斜侧内壁','口缘内壁'],
          'outer':np.round(outer,8).ravel().tolist(),
          'initialInner':np.round(initial_inner,8).ravel().tolist(),'cutOffsets':offsets,
          'strikePoints':np.round(pts,8).tolist(),'modesFile':binary.name,
          'modeStride':outer.size,'defaultTarget':[3,3,3],'states':states}
    temp=output.with_suffix('.tmp')
    temp.write_text(json.dumps(data,separators=(',',':'),allow_nan=False),encoding='utf-8');temp.replace(output)
    print(json.dumps({'states':len(states),'jsonBytes':output.stat().st_size,'modeBytes':binary.stat().st_size,
                      'seconds':round(time.perf_counter()-started,2),'model':model},ensure_ascii=False),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--output')
    parser.add_argument('--inspect',action='store_true')
    parser.add_argument('--check',action='store_true')
    args=parser.parse_args()
    if args.inspect: inspect()
    elif args.check: check(args.output or 'public/data/model-checks.json')
    else: generate(args.output or 'public/data/bell-atlas.json')
