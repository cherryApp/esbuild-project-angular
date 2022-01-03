import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ConfigService {

  testList: {name: string}[] = [
    {name: 'Chris'},
  ];

  constructor(
    private http: HttpClient,
  ) {}

  getAll(): Observable<any> {
    return this.http.get('https://nettuts.hu/jms/test/users');
  }
}
